import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { round2 } from '../common/calc';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
  ) {}

  /** UNPAID / PARTIALLY_PAID / PAID derived from paidAmount vs total. */
  private paymentStatus(po: { total: any; paidAmount: any }) {
    const total = Number(po.total);
    const paid = Number(po.paidAmount);
    if (total > 0 && paid >= total - 0.01) return 'PAID';
    if (paid > 0) return 'PARTIALLY_PAID';
    return 'UNPAID';
  }

  /**
   * Delivery cost is billed once for the whole shipment but must land on
   * each unit's cost price, so it's split evenly across every unit ordered
   * on the PO: e.g. $100 delivery / 200 units ordered = $0.50/unit, added
   * to that unit's purchase cost when it's received (see applyWeightedAverageCost).
   */
  private deliveryCostPerUnit(po: { hasDeliveryCost: boolean; deliveryCost: any; items: { quantity: number }[] }) {
    if (!po.hasDeliveryCost) return 0;
    const totalQty = po.items.reduce((s, i) => s + i.quantity, 0);
    return totalQty > 0 ? Number(po.deliveryCost) / totalQty : 0;
  }

  findAll(query: { search?: string; status?: string; paymentStatus?: string; supplierId?: string; page?: number; pageSize?: number }) {
    const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    // paymentStatus (UNPAID/PARTIALLY_PAID/PAID) is computed from paidAmount vs
    // total, not a stored column — only UNPAID reduces to a plain column check
    // (paidAmount <= 0); PARTIALLY_PAID/PAID would need a paidAmount-vs-total
    // comparison Prisma can't express without raw SQL, so only UNPAID is offered.
    if (query.paymentStatus === 'UNPAID') where.paidAmount = { lte: 0 };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.purchaseOrder.count({ where });
    return this.prisma.purchaseOrder
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: { supplier: { select: { name: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({
        items: items.map((po) => ({ ...po, paymentStatus: this.paymentStatus(po) })),
        total: await totalPromise,
        page,
        pageSize,
      }));
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { select: { sku: true, name: true, trackSerials: true } } } },
        goodsReceipts: { include: { createdBy: { select: { name: true } } }, orderBy: { receivedAt: 'desc' } },
        invoices: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
        payments: { where: { deletedAt: null }, orderBy: { paymentDate: 'desc' }, select: { id: true, number: true, amount: true, method: true, paymentDate: true, reference: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return { ...po, paymentStatus: this.paymentStatus(po), deliveryCostPerUnit: this.deliveryCostPerUnit(po) };
  }

  async create(userId: string, dto: any) {
    const items = dto.items.map((i: any) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitCost: i.unitCost,
      lineTotal: round2(i.quantity * i.unitCost),
    }));
    const subtotal = round2(items.reduce((s: number, i: any) => s + i.lineTotal, 0));
    const hasDeliveryCost = !!dto.hasDeliveryCost;
    const deliveryCost = hasDeliveryCost ? round2(Number(dto.deliveryCost) || 0) : 0;
    const total = round2(subtotal + deliveryCost);
    const number = await this.numbering.next('PURCHASE_ORDER');
    const po = await this.prisma.purchaseOrder.create({
      data: {
        number,
        supplierId: dto.supplierId,
        warehouseId: dto.warehouseId,
        status: dto.status ?? 'DRAFT',
        expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : undefined,
        currency: dto.currency ?? 'USD',
        exchangeRate: dto.exchangeRate ?? 1,
        subtotal,
        hasDeliveryCost,
        deliveryCost,
        total,
        notes: dto.notes,
        createdById: userId,
        items: { create: items },
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'CREATE', 'PurchaseOrder', po.id, { number });
    return po;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw new NotFoundException('Purchase order not found');
    if (!['DRAFT', 'SENT'].includes(existing.status))
      throw new BadRequestException('Only draft/sent purchase orders can be edited');

    let itemsData = undefined as any;
    let subtotal = Number(existing.subtotal);
    if (dto.items) {
      const items = dto.items.map((i: any) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitCost: i.unitCost,
        lineTotal: round2(i.quantity * i.unitCost),
      }));
      subtotal = round2(items.reduce((s: number, i: any) => s + i.lineTotal, 0));
      itemsData = { deleteMany: {}, create: items };
    }
    const hasDeliveryCost = dto.hasDeliveryCost ?? existing.hasDeliveryCost;
    const deliveryCost = hasDeliveryCost ? round2(Number(dto.deliveryCost ?? existing.deliveryCost) || 0) : 0;
    const total = round2(subtotal + deliveryCost);

    const po = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        warehouseId: dto.warehouseId,
        status: dto.status,
        expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : undefined,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        notes: dto.notes,
        subtotal,
        hasDeliveryCost,
        deliveryCost,
        total,
        ...(itemsData ? { items: itemsData } : {}),
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'UPDATE', 'PurchaseOrder', id);
    return po;
  }

  /**
   * Receive goods against a PO. lines: [{ productId, quantity, serialNumbers?, manufactureDate? }]
   * Adds stock, registers serial-numbered units, flags discrepancies.
   */
  async receive(
    userId: string,
    id: string,
    dto: { lines: { productId: string; quantity: number; serialNumbers?: string[]; manufactureDate?: string }[]; notes?: string },
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (['RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.status))
      throw new BadRequestException(`Cannot receive against a ${po.status} order`);

    const discrepancies: string[] = [];
    const deliveryCostPerUnit = this.deliveryCostPerUnit(po);

    await this.prisma.$transaction(async (tx) => {
      for (const line of dto.lines) {
        const item = po.items.find((i) => i.productId === line.productId);
        if (!item) {
          discrepancies.push(`Product #${line.productId} was not on the PO`);
        } else if (item.receivedQty + line.quantity > item.quantity) {
          discrepancies.push(
            `Product #${line.productId}: received ${item.receivedQty + line.quantity} exceeds ordered ${item.quantity}`,
          );
        }
        if (line.serialNumbers && line.serialNumbers.length !== line.quantity) {
          throw new BadRequestException(
            `Product #${line.productId}: ${line.serialNumbers.length} serials provided for ${line.quantity} units`,
          );
        }

        if (item) {
          // Must run before adjustStock so on-hand quantity is pre-receipt.
          await this.applyWeightedAverageCost(tx, {
            productId: line.productId,
            receivedQty: line.quantity,
            receivedUnitCost: round2(Number(item.unitCost) + deliveryCostPerUnit),
            userId,
            poNumber: po.number,
            deliveryCostPerUnit,
          });
        }

        await this.stock.adjustStock(tx, {
          productId: line.productId,
          warehouseId: po.warehouseId,
          delta: line.quantity,
          type: 'IN',
          userId,
          reason: `Goods received on ${po.number}`,
          refType: 'PurchaseOrder',
          refId: po.id,
        });

        if (line.serialNumbers?.length) {
          await this.stock.registerUnits(tx, {
            productId: line.productId,
            warehouseId: po.warehouseId,
            serialNumbers: line.serialNumbers,
            purchaseOrderId: po.id,
            manufactureDate: line.manufactureDate ? new Date(line.manufactureDate) : undefined,
          });
        }

        if (item) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQty: { increment: line.quantity } },
          });
        }
      }

      await tx.goodsReceipt.create({
        data: {
          purchaseOrderId: po.id,
          notes: dto.notes,
          discrepancies: discrepancies.length ? discrepancies.join('; ') : null,
          items: dto.lines as any,
          createdById: userId,
        },
      });

      const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const fullyReceived = updatedItems.every((i) => i.receivedQty >= i.quantity);
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });
    });

    await this.audit.log(userId, 'RECEIVE', 'PurchaseOrder', id, { lines: dto.lines.length, discrepancies });
    return { ...(await this.findOne(id)), receiptDiscrepancies: discrepancies };
  }

  /**
   * Re-cost a product on goods receipt using the weighted average cost method:
   *   newCost = (onHandQty * currentCost + receivedQty * receivedUnitCost) / (onHandQty + receivedQty)
   * If nothing is on hand, the received cost becomes the new cost. Every change
   * is recorded in PriceHistory so the cost trail stays auditable.
   */
  private async applyWeightedAverageCost(
    tx: Prisma.TransactionClient,
    params: { productId: string; receivedQty: number; receivedUnitCost: number; userId: string; poNumber: string; deliveryCostPerUnit?: number },
  ) {
    const product = await tx.product.findUnique({
      where: { id: params.productId },
      select: { costPrice: true },
    });
    if (!product || params.receivedQty <= 0) return;

    const agg = await tx.stockLevel.aggregate({
      where: { productId: params.productId },
      _sum: { quantity: true },
    });
    const onHand = Math.max(agg._sum.quantity ?? 0, 0);
    const oldCost = Number(product.costPrice);
    const totalQty = onHand + params.receivedQty;
    const newCost =
      totalQty > 0
        ? round2((onHand * oldCost + params.receivedQty * params.receivedUnitCost) / totalQty)
        : params.receivedUnitCost;
    if (newCost === oldCost) return;

    await tx.product.update({
      where: { id: params.productId },
      data: { costPrice: newCost, priceUpdatedAt: new Date() },
    });
    await tx.priceHistory.create({
      data: {
        productId: params.productId,
        oldCostPrice: oldCost,
        newCostPrice: newCost,
        reason: `Weighted average cost on ${params.poNumber}: ${onHand} on hand @ ${oldCost} + ${params.receivedQty} received @ ${params.receivedUnitCost}${params.deliveryCostPerUnit ? ` (incl. ${round2(params.deliveryCostPerUnit)}/unit delivery)` : ''}`,
        changedById: params.userId,
      },
    });
  }

  /**
   * Record a supplier payment against this PO. Payments can be made at any
   * time (deposit, partial, or full) and are also visible on the Payments page
   * as OUTGOING payments.
   */
  async pay(
    userId: string,
    id: string,
    dto: { amount: number; method: string; reference?: string; notes?: string; paymentDate?: string },
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'CANCELLED') throw new BadRequestException('Cannot pay a cancelled purchase order');
    const remaining = round2(Number(po.total) - Number(po.paidAmount));
    if (dto.amount > remaining + 0.01)
      throw new BadRequestException(`Payment exceeds remaining balance (${remaining.toFixed(2)})`);

    const number = await this.numbering.next('PAYMENT');
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          number,
          direction: 'OUTGOING',
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          method: dto.method as any,
          amount: dto.amount,
          currency: po.currency,
          exchangeRate: po.exchangeRate,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          reference: dto.reference,
          notes: dto.notes ?? `Payment on ${po.number}`,
          createdById: userId,
        },
      });
      await tx.purchaseOrder.update({
        where: { id },
        data: { paidAmount: { increment: dto.amount } },
      });
    });
    await this.audit.log(userId, 'PAY', 'PurchaseOrder', id, { number: po.number, amount: dto.amount });
    return this.findOne(id);
  }

  async setStatus(userId: string, id: string, status: string) {
    const allowed = ['DRAFT', 'SENT', 'CLOSED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new BadRequestException(`Status must be one of ${allowed.join(', ')}`);
    const po = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: status as any } });
    await this.audit.log(userId, 'STATUS_CHANGE', 'PurchaseOrder', id, { status });
    return po;
  }
}
