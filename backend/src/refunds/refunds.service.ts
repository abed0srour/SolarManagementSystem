import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { InvoicesService } from '../invoices/invoices.service';
import { round2 } from '../common/calc';

@Injectable()
export class RefundsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
    private invoices: InvoicesService,
  ) {}

  /**
   * Create a refund starting from a sales order (the UI works in orders, not
   * invoices). Resolves the order's active invoice — generating the full
   * invoice first when none exists — then delegates to the regular flow.
   * The refund is approved and completed immediately so resellable items are
   * restocked into the order's warehouse without extra manual steps.
   */
  async createFromOrder(userId: string, dto: any) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id: dto.salesOrderId },
      include: { invoices: { where: { deletedAt: null, status: { not: 'CANCELLED' } } } },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Cannot refund a cancelled order');
    if (so.status === 'PENDING') throw new BadRequestException('Order is not confirmed yet — cancel it instead of refunding');

    let invoiceId = so.invoices[0]?.id;
    if (!invoiceId) {
      const inv = await this.invoices.fromSalesOrder(userId, so.id, {});
      invoiceId = inv.id;
    }
    const refund = await this.create(userId, { ...dto, invoiceId });
    await this.approve(userId, refund.id);
    return this.complete(userId, refund.id, so.warehouseId);
  }

  findAll(query: { status?: string; clientId?: string; salesOrderId?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.RefundWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.salesOrderId) where.invoice = { salesOrderId: query.salesOrderId };
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { invoice: { number: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.refund.count({ where });
    return this.prisma.refund
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          client: { select: { name: true } },
          invoice: { select: { number: true, salesOrderId: true, salesOrder: { select: { number: true } } } },
          items: { include: { product: { select: { sku: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const r = await this.prisma.refund.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: true,
        invoice: { include: { items: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    if (!r) throw new NotFoundException('Refund not found');
    return r;
  }

  async create(userId: string, dto: any) {
    const invoice = await this.prisma.invoice.findUnique({ relationLoadStrategy: 'join',
      where: { id: dto.invoiceId },
      include: { items: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.type !== 'SALE') throw new BadRequestException('Refunds apply to sale invoices');
    if (!invoice.clientId) throw new BadRequestException('Invoice has no client');

    // Validate quantities against what was invoiced (minus already returned)
    for (const item of dto.items) {
      const invoicedQty = invoice.items
        .filter((i) => i.productId === item.productId)
        .reduce((s, i) => s + Number(i.quantity), 0);
      const previouslyReturned = await this.prisma.returnItem.aggregate({
        where: {
          productId: item.productId,
          refund: { invoiceId: dto.invoiceId, status: { notIn: ['REJECTED'] } },
        },
        _sum: { quantity: true },
      });
      const alreadyReturned = previouslyReturned._sum.quantity ?? 0;
      if (item.quantity + alreadyReturned > invoicedQty) {
        throw new BadRequestException(
          `Return quantity for product #${item.productId} exceeds invoiced quantity (${invoicedQty}, already returned ${alreadyReturned})`,
        );
      }
    }

    const totalAmount = round2(dto.items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0));
    const number = await this.numbering.next('REFUND');
    const refund = await this.prisma.refund.create({
      data: {
        number,
        invoiceId: dto.invoiceId,
        clientId: invoice.clientId,
        reason: dto.reason ?? 'OTHER',
        method: dto.method ?? 'CASH',
        totalAmount,
        notes: dto.notes,
        createdById: userId,
        items: {
          create: dto.items.map((i: any) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            condition: i.condition ?? 'RESELLABLE',
            serialNumbers: i.serialNumbers ?? undefined,
          })),
        },
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'CREATE', 'Refund', refund.id, { number, totalAmount });
    return refund;
  }

  async approve(userId: string, id: string) {
    const r = await this.prisma.refund.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.status !== 'PENDING') throw new BadRequestException(`Refund is ${r.status}`);
    const updated = await this.prisma.refund.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId },
    });
    await this.audit.log(userId, 'APPROVE', 'Refund', id, { number: r.number });
    return updated;
  }

  async reject(userId: string, id: string, reason?: string) {
    const r = await this.prisma.refund.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.status !== 'PENDING') throw new BadRequestException(`Refund is ${r.status}`);
    const updated = await this.prisma.refund.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: userId, notes: reason ? `${r.notes ?? ''}\nRejected: ${reason}`.trim() : r.notes },
    });
    await this.audit.log(userId, 'REJECT', 'Refund', id, { number: r.number, reason });
    return updated;
  }

  /**
   * Complete an approved refund: restock resellable items (or mark damaged),
   * flag serial units RETURNED/DAMAGED, and issue store credit if applicable.
   */
  async complete(userId: string, id: string, warehouseId: string) {
    const r = await this.prisma.refund.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { items: { include: { product: { select: { isService: true } } } } },
    });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('Refund must be approved first');

    await this.prisma.$transaction(async (tx) => {
      for (const item of r.items) {
        if (item.product?.isService) continue; // services are never restocked
        if (item.condition === 'RESELLABLE') {
          await this.stock.adjustStock(tx, {
            productId: item.productId,
            warehouseId,
            delta: item.quantity,
            type: 'RETURN_IN',
            userId,
            reason: `Refund ${r.number} — restocked`,
            refType: 'Refund',
            refId: r.id,
          });
        }
        const serials = (item.serialNumbers as string[] | null) ?? [];
        if (serials.length) {
          // Resellable units go straight back into stock, fully detached from
          // the old sale, so their serial numbers are sellable again.
          await tx.productUnit.updateMany({
            where: { serialNumber: { in: serials } },
            data:
              item.condition === 'RESELLABLE'
                ? {
                    status: 'IN_STOCK',
                    warehouseId,
                    salesOrderId: null,
                    invoiceId: null,
                    warrantyStartDate: null,
                    warrantyEndDate: null,
                    performanceWarrantyEndDate: null,
                  }
                : { status: 'DAMAGED', warehouseId },
          });
        }
      }
      if (r.method === 'STORE_CREDIT') {
        await tx.client.update({
          where: { id: r.clientId },
          data: { storeCredit: { increment: Number(r.totalAmount) } },
        });
      }
      await tx.refund.update({ where: { id }, data: { status: 'COMPLETED' } });
    });
    await this.audit.log(userId, 'COMPLETE', 'Refund', id, { number: r.number, method: r.method });
    return this.findOne(id);
  }
}
