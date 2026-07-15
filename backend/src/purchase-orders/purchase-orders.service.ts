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

  findAll(query: { search?: string; status?: string; supplierId?: string; page?: number; pageSize?: number }) {
    const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return this.prisma.purchaseOrder
      .findMany({
        where,
        include: { supplier: { select: { name: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await this.prisma.purchaseOrder.count({ where }), page, pageSize }));
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { select: { sku: true, name: true, trackSerials: true } } } },
        goodsReceipts: { include: { createdBy: { select: { name: true } } }, orderBy: { receivedAt: 'desc' } },
        invoices: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async create(userId: string, dto: any) {
    const items = dto.items.map((i: any) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitCost: i.unitCost,
      lineTotal: round2(i.quantity * i.unitCost),
    }));
    const subtotal = round2(items.reduce((s: number, i: any) => s + i.lineTotal, 0));
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
        total: subtotal,
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
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Purchase order not found');
    if (!['DRAFT', 'SENT'].includes(existing.status))
      throw new BadRequestException('Only draft/sent purchase orders can be edited');

    let itemsData = undefined as any;
    let totals = {} as any;
    if (dto.items) {
      const items = dto.items.map((i: any) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitCost: i.unitCost,
        lineTotal: round2(i.quantity * i.unitCost),
      }));
      const subtotal = round2(items.reduce((s: number, i: any) => s + i.lineTotal, 0));
      totals = { subtotal, total: subtotal };
      itemsData = { deleteMany: {}, create: items };
    }
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
        ...totals,
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
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (['RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.status))
      throw new BadRequestException(`Cannot receive against a ${po.status} order`);

    const discrepancies: string[] = [];

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

  async setStatus(userId: string, id: string, status: string) {
    const allowed = ['DRAFT', 'SENT', 'CLOSED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new BadRequestException(`Status must be one of ${allowed.join(', ')}`);
    const po = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: status as any } });
    await this.audit.log(userId, 'STATUS_CHANGE', 'PurchaseOrder', id, { status });
    return po;
  }
}
