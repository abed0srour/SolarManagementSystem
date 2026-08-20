import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { round2 } from '../common/calc';
import { applyWeightedAverageCost } from '../common/costing';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
  ) {}

  /**
   * UNPAID / PARTIALLY_PAID / PAID derived from paidAmount vs what we still
   * owe. Goods sent back to the supplier reduce the bill, so the yardstick is
   * `total - returnedAmount`, not the original total — a fully returned PO is
   * settled even though nothing was ever paid on it.
   */
  private paymentStatus(po: { total: any; paidAmount: any; returnedAmount?: any }) {
    const total = round2(Number(po.total) - Number(po.returnedAmount ?? 0));
    const paid = Number(po.paidAmount);
    if (total <= 0.01) return 'PAID';
    if (paid >= total - 0.01) return 'PAID';
    if (paid > 0) return 'PARTIALLY_PAID';
    return 'UNPAID';
  }

  /** What is still owed on the PO after returns and payments. */
  private remainingAmount(po: { total: any; paidAmount: any; returnedAmount?: any }) {
    return Math.max(0, round2(Number(po.total) - Number(po.returnedAmount ?? 0) - Number(po.paidAmount)));
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

  /**
   * Whether this purchase order can still be cancelled, and if not, why.
   *
   * A purchase order can be cancelled before goods are received and before
   * any payment is made. What makes it uncancellable:
   *  - ALREADY_CANCELLED: already cancelled
   *  - HAS_RECEIPTS: goods have been received (receivedQty > 0 or goodsReceipts exist)
   *  - HAS_PAYMENTS: payments have been made against this order (paidAmount > 0 or payments exist)
   */
  private cancelInfo(po: {
    status: string;
    paidAmount?: any;
    items?: { receivedQty: number }[];
    goodsReceipts?: any[];
    payments?: any[];
  }): { cancellable: boolean; cancelBlockedReason: string | null } {
    const hasReceipts =
      (po.items ?? []).some((i) => i.receivedQty > 0) || (po.goodsReceipts ?? []).length > 0;
    const hasPayments =
      Number(po.paidAmount ?? 0) > 0 || (po.payments ?? []).length > 0;

    const reason =
      po.status === 'CANCELLED'
        ? 'ALREADY_CANCELLED'
        : hasReceipts
        ? 'HAS_RECEIPTS'
        : hasPayments
        ? 'HAS_PAYMENTS'
        : null;

    return { cancellable: reason === null, cancelBlockedReason: reason };
  }

  findAll(query: {
    search?: string;
    status?: string;
    paymentStatus?: string;
    supplierId?: string;
    page?: number;
    pageSize?: number;
    archived?: string;
  }) {
    const where: Prisma.PurchaseOrderWhereInput =
      query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    if (query.status) where.status = query.status as any;
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
        include: {
          supplier: { select: { name: true } },
          items: true,
          goodsReceipts: true,
          payments: { where: { deletedAt: null } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({
        items: items.map((po) => {
          const { cancellable, cancelBlockedReason } = this.cancelInfo(po);
          return {
            ...po,
            paymentStatus: this.paymentStatus(po),
            remainingAmount: this.remainingAmount(po),
            cancellable,
            cancelBlockedReason,
          };
        }),
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
        payments: { where: { deletedAt: null }, orderBy: { paymentDate: 'desc' }, select: { id: true, number: true, direction: true, amount: true, method: true, paymentDate: true, reference: true } },
        returns: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, status: true, refundMethod: true, totalAmount: true, creditNoteRef: true, createdAt: true },
        },
        createdBy: { select: { name: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    const { cancellable, cancelBlockedReason } = this.cancelInfo(po);
    return {
      ...po,
      paymentStatus: this.paymentStatus(po),
      remainingAmount: this.remainingAmount(po),
      deliveryCostPerUnit: this.deliveryCostPerUnit(po),
      cancellable,
      cancelBlockedReason,
    };
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
          await applyWeightedAverageCost(tx, {
            productId: line.productId,
            receivedQty: line.quantity,
            receivedUnitCost: round2(Number(item.unitCost) + deliveryCostPerUnit),
            userId,
            source: po.number,
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
    // Returned goods are no longer payable, so they come off the balance.
    const remaining = this.remainingAmount(po);
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

  async cancel(userId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      relationLoadStrategy: 'join',
      where: { id },
      include: {
        items: true,
        goodsReceipts: true,
        payments: { where: { deletedAt: null } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'CANCELLED') throw new BadRequestException('Purchase order already cancelled');

    const hasReceipts =
      (po.items ?? []).some((i) => i.receivedQty > 0) || (po.goodsReceipts ?? []).length > 0;
    if (hasReceipts) {
      throw new BadRequestException('Cannot cancel a purchase order with received goods');
    }

    const hasPayments =
      Number(po.paidAmount ?? 0) > 0 || (po.payments ?? []).length > 0;
    if (hasPayments) {
      throw new BadRequestException('Cannot cancel a purchase order with recorded payments');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.log(userId, 'CANCEL', 'PurchaseOrder', id, { number: po.number });
    return updated;
  }

  async setStatus(userId: string, id: string, status: string) {
    const allowed = ['DRAFT', 'SENT', 'CLOSED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new BadRequestException(`Status must be one of ${allowed.join(', ')}`);
    if (status === 'CANCELLED') {
      return this.cancel(userId, id);
    }
    const po = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: status as any } });
    await this.audit.log(userId, 'STATUS_CHANGE', 'PurchaseOrder', id, { status });
    return po;
  }

  private async orderUsage(id: string) {
    const [goodsReceipts, payments, returns, units, invoices, stockMovements] = await Promise.all([
      this.prisma.goodsReceipt.count({ where: { purchaseOrderId: id } }),
      this.prisma.payment.count({ where: { purchaseOrderId: id, deletedAt: null } }),
      this.prisma.supplierReturn.count({ where: { purchaseOrderId: id, deletedAt: null } }),
      this.prisma.productUnit.count({ where: { purchaseOrderId: id } }),
      this.prisma.invoice.count({ where: { purchaseOrderId: id, deletedAt: null } }),
      this.prisma.stockMovement.count({ where: { refType: 'PurchaseOrder', refId: id } }),
    ]);
    return { goodsReceipts, payments, returns, units, invoices, stockMovements };
  }

  /** Can this purchase order be deleted outright? `remove()` re-checks server-side. */
  async usage(id: string): Promise<UsageReport> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    const counts = await this.orderUsage(id);
    return {
      used: !isUnused(counts),
      usedBy: usedBy(counts),
      blockedReason: po.status === 'CANCELLED' ? undefined : 'NOT_CANCELLED',
    };
  }

  /**
   * Delete a cancelled purchase order: permanently (PURGED) when nothing came of it
   * (no receipts, no payments, etc.), or archived (ARCHIVED) when it left history behind.
   * See `common/safe-delete.ts`.
   */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.deletedAt) throw new BadRequestException('Purchase order is already deleted');
    if (po.status !== 'CANCELLED')
      throw new BadRequestException('Only a cancelled purchase order can be deleted — cancel it first');

    const counts = await this.orderUsage(id);
    if (isUnused(counts)) {
      // Items cascade with the order.
      await this.prisma.purchaseOrder.delete({ where: { id } });
      await this.audit.log(userId, 'PURGE', 'PurchaseOrder', id, { number: po.number });
      return { success: true, mode: 'PURGED', usedBy: {} };
    }
    const used = usedBy(counts);
    await this.prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'PurchaseOrder', id, { number: po.number, usedBy: used });
    return { success: true, mode: 'ARCHIVED', usedBy: used };
  }

  /** Bring an archived purchase order back into the active list. */
  async restore(userId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (!po.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log(userId, 'RESTORE', 'PurchaseOrder', id, { number: po.number });
    return { success: true, alreadyActive: false };
  }
}
