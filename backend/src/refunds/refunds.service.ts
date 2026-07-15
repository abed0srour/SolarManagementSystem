import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { round2 } from '../common/calc';

@Injectable()
export class RefundsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
  ) {}

  findAll(query: { status?: string; clientId?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.RefundWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { invoice: { number: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return this.prisma.refund
      .findMany({
        where,
        include: {
          client: { select: { name: true } },
          invoice: { select: { number: true } },
          items: { include: { product: { select: { sku: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await this.prisma.refund.count({ where }), page, pageSize }));
  }

  async findOne(id: string) {
    const r = await this.prisma.refund.findUnique({
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
    const invoice = await this.prisma.invoice.findUnique({
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
        .reduce((s, i) => s + i.quantity, 0);
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
    const r = await this.prisma.refund.findUnique({ where: { id }, include: { items: true } });
    if (!r) throw new NotFoundException('Refund not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('Refund must be approved first');

    await this.prisma.$transaction(async (tx) => {
      for (const item of r.items) {
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
          await tx.productUnit.updateMany({
            where: { serialNumber: { in: serials } },
            data: {
              status: item.condition === 'RESELLABLE' ? 'RETURNED' : 'DAMAGED',
              warehouseId,
            },
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
