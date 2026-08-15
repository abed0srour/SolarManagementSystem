import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { round2 } from '../common/calc';

interface ReturnLine {
  productId: string;
  quantity: number;
  unitCost?: number;
  serialNumbers?: string[];
  reason?: string;
}

interface CreateReturnDto {
  purchaseOrderId: string;
  items: ReturnLine[];
  refundMethod?: 'CASH' | 'WHISH' | 'OMT' | 'CREDIT_NOTE';
  creditNoteRef?: string;
  notes?: string;
  refundDate?: string;
}

/**
 * Returning goods to the supplier — the mirror image of a goods receipt.
 * Stock leaves the warehouse, the serial units are retired, and the money we
 * paid comes back either as a real payment or as a credit note against the PO.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
  ) {}

  findAll(query: {
    supplierId?: string;
    purchaseOrderId?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.SupplierReturnWhereInput = { deletedAt: null };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.status) where.status = query.status as any;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { creditNoteRef: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
        { purchaseOrder: { number: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.supplierReturn.count({ where });
    return this.prisma.supplierReturn
      .findMany({
        relationLoadStrategy: 'join',
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true, currency: true } },
          warehouse: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const ret = await this.prisma.supplierReturn.findUnique({
      relationLoadStrategy: 'join',
      where: { id },
      include: {
        supplier: true,
        purchaseOrder: { select: { id: true, number: true, currency: true, total: true, paidAmount: true, returnedAmount: true } },
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!ret) throw new NotFoundException('Supplier return not found');
    // items is Json, so the product names have to be joined in by hand.
    const lines = (ret.items as unknown as ReturnLine[]) ?? [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true, sku: true, name: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return { ...ret, items: lines.map((l) => ({ ...l, product: byId.get(l.productId) ?? null })) };
  }

  /**
   * What can still be sent back on a PO: everything received minus everything
   * already returned, with the in-stock serial units that came in on this PO.
   */
  async returnable(purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      relationLoadStrategy: 'join',
      where: { id: purchaseOrderId },
      include: {
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        items: { include: { product: { select: { sku: true, name: true, trackSerials: true, isService: true } } } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const units = await this.prisma.productUnit.findMany({
      where: { purchaseOrderId, status: 'IN_STOCK' },
      select: { id: true, productId: true, serialNumber: true },
      orderBy: { serialNumber: 'asc' },
    });
    const serialsByProduct: Record<string, string[]> = {};
    for (const u of units) (serialsByProduct[u.productId] ??= []).push(u.serialNumber);

    return {
      id: po.id,
      number: po.number,
      status: po.status,
      currency: po.currency,
      supplier: po.supplier,
      warehouse: po.warehouse,
      total: po.total,
      paidAmount: po.paidAmount,
      returnedAmount: po.returnedAmount,
      items: po.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        product: i.product,
        quantity: i.quantity,
        receivedQty: i.receivedQty,
        returnedQty: i.returnedQty,
        returnableQty: Math.max(0, i.receivedQty - i.returnedQty),
        unitCost: i.unitCost,
        availableSerials: serialsByProduct[i.productId] ?? [],
      })),
    };
  }

  /**
   * Send goods back to the supplier and take the money back.
   *
   * Stock is removed at the PO's unit cost, which is the same cost it was
   * received at — returning at cost leaves the product's weighted average
   * untouched, so no re-costing is needed here.
   */
  async create(userId: string, dto: CreateReturnDto) {
    const po = await this.prisma.purchaseOrder.findUnique({
      relationLoadStrategy: 'join',
      where: { id: dto.purchaseOrderId },
      include: { items: { include: { product: { select: { name: true, trackSerials: true, isService: true } } } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'CANCELLED') throw new BadRequestException('Cannot return against a cancelled purchase order');
    if (!dto.items?.length) throw new BadRequestException('Nothing to return');

    const method = dto.refundMethod ?? 'CASH';

    // ---- Validate every line before touching anything ----
    const seen = new Set<string>();
    const lines = dto.items.map((line) => {
      if (seen.has(line.productId)) throw new BadRequestException('Each product may only appear once on a return');
      seen.add(line.productId);

      const item = po.items.find((i) => i.productId === line.productId);
      if (!item) throw new BadRequestException(`Product #${line.productId} is not on purchase order ${po.number}`);
      if (line.quantity <= 0) throw new BadRequestException(`Return quantity for "${item.product.name}" must be positive`);

      const returnable = item.receivedQty - item.returnedQty;
      if (line.quantity > returnable) {
        throw new BadRequestException(
          `Cannot return ${line.quantity} of "${item.product.name}": only ${returnable} left ` +
            `(received ${item.receivedQty}, already returned ${item.returnedQty})`,
        );
      }

      const serials = line.serialNumbers ?? [];
      if (serials.length && serials.length !== line.quantity) {
        throw new BadRequestException(
          `"${item.product.name}": ${serials.length} serials selected for ${line.quantity} units`,
        );
      }

      const unitCost = line.unitCost ?? Number(item.unitCost);
      if (unitCost < 0) throw new BadRequestException('Unit cost cannot be negative');

      return { line, item, serials, unitCost, lineTotal: round2(line.quantity * unitCost) };
    });

    const totalAmount = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    // Only refund cash we actually paid — a supplier can't hand back more than
    // it received, and the rest is simply an unpaid balance that disappears.
    const cashRefund = method === 'CREDIT_NOTE' ? 0 : Math.min(totalAmount, round2(Number(po.paidAmount)));

    const number = await this.numbering.next('SUPPLIER_RETURN');
    const paymentNumber = cashRefund > 0 ? await this.numbering.next('PAYMENT') : null;

    const returnId = await this.prisma.$transaction(async (tx) => {
      // Created first so the stock movements can point at a real return id.
      const ret = await tx.supplierReturn.create({
        data: {
          number,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          warehouseId: po.warehouseId,
          status: method === 'CREDIT_NOTE' ? 'CREDITED' : 'SENT',
          refundMethod: method,
          totalAmount,
          creditNoteRef: dto.creditNoteRef,
          notes: dto.notes,
          createdById: userId,
          items: lines.map(({ line, serials, unitCost, lineTotal }) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitCost,
            lineTotal,
            serialNumbers: serials.length ? serials : undefined,
            reason: line.reason,
          })) as unknown as Prisma.InputJsonValue,
        },
      });

      for (const { line, item, serials } of lines) {
        // Services were never stocked, so there is nothing to take out.
        if (!item.product.isService) {
          await this.stock.adjustStock(tx, {
            productId: line.productId,
            warehouseId: po.warehouseId,
            delta: -line.quantity,
            type: 'RETURN_OUT',
            userId,
            reason: `Returned to supplier on ${number} (${po.number})`,
            refType: 'SupplierReturn',
            refId: ret.id,
          });
        }

        if (serials.length) {
          // Only units still sitting in stock from this PO can go back — a unit
          // already sold or returned once must not be shipped out twice.
          const eligible = await tx.productUnit.findMany({
            where: { serialNumber: { in: serials }, productId: line.productId, purchaseOrderId: po.id, status: 'IN_STOCK' },
            select: { serialNumber: true },
          });
          if (eligible.length !== serials.length) {
            const ok = new Set(eligible.map((u) => u.serialNumber));
            throw new BadRequestException(
              `These serials are not in stock on ${po.number} and cannot be returned: ` +
                serials.filter((s) => !ok.has(s)).join(', '),
            );
          }
          await tx.productUnit.updateMany({
            where: { serialNumber: { in: serials } },
            data: { status: 'RETURNED_TO_SUPPLIER', warehouseId: null },
          });
        }

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { returnedQty: { increment: line.quantity } },
        });
      }

      if (paymentNumber && cashRefund > 0) {
        // Money coming back in, so INCOMING — it shows on the Payments page
        // next to the outgoing payment it reverses.
        await tx.payment.create({
          data: {
            number: paymentNumber,
            direction: 'INCOMING',
            purchaseOrderId: po.id,
            supplierId: po.supplierId,
            method: method as any,
            amount: cashRefund,
            currency: po.currency,
            exchangeRate: po.exchangeRate,
            paymentDate: dto.refundDate ? new Date(dto.refundDate) : new Date(),
            reference: dto.creditNoteRef,
            notes: `Refund from supplier on ${number} (${po.number})`,
            createdById: userId,
          },
        });
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          returnedAmount: { increment: totalAmount },
          // Cash back reduces what we have paid; the credit-note case leaves
          // paidAmount alone and shrinks the bill instead.
          ...(cashRefund > 0 ? { paidAmount: { decrement: cashRefund } } : {}),
        },
      });

      return ret.id;
    });

    await this.audit.log(userId, 'RETURN', 'PurchaseOrder', po.id, {
      number,
      purchaseOrder: po.number,
      totalAmount,
      cashRefund,
      method,
    });
    return this.findOne(returnId);
  }

  /** Move a return along its lifecycle (SENT -> CREDITED/REPLACED/CLOSED). */
  async setStatus(userId: string, id: string, data: { status: string; creditNoteRef?: string; notes?: string }) {
    const existing = await this.prisma.supplierReturn.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier return not found');
    const ret = await this.prisma.supplierReturn.update({
      where: { id },
      data: { status: data.status as any, creditNoteRef: data.creditNoteRef, notes: data.notes },
    });
    await this.audit.log(userId, 'STATUS_CHANGE', 'SupplierReturn', id, { number: ret.number, status: data.status });
    return ret;
  }
}
