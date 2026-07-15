import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { calcDocTotals, calcLine } from '../common/calc';

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { search?: string; status?: string; clientId?: string; page?: number; pageSize?: number }) {
    const where: Prisma.QuotationWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return this.prisma.quotation
      .findMany({
        where,
        include: { client: { select: { name: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await this.prisma.quotation.count({ where }), page, pageSize }));
  }

  async findOne(id: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        client: { include: { addresses: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
        salesOrders: { select: { id: true, number: true, status: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  private buildItems(items: any[]) {
    return items.map((i) => {
      const t = calcLine(i);
      return {
        productId: i.productId,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountType: i.discountType ?? null,
        discountValue: i.discountValue ?? 0,
        taxRatePct: i.taxRatePct ?? 0,
        lineTotal: t.lineTotal,
        _totals: t,
      };
    });
  }

  async create(userId: string, dto: any) {
    const built = this.buildItems(dto.items);
    const totals = calcDocTotals(
      built.map((b) => b._totals),
      dto.discountType,
      dto.discountValue,
    );
    const number = await this.numbering.next('QUOTATION');
    const q = await this.prisma.quotation.create({
      data: {
        number,
        clientId: dto.clientId,
        status: dto.status ?? 'DRAFT',
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        discountType: dto.discountType ?? null,
        discountValue: dto.discountValue ?? 0,
        notes: dto.notes,
        ...totals,
        createdById: userId,
        items: { create: built.map(({ _totals, ...item }) => item) },
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'CREATE', 'Quotation', q.id, { number });
    return q;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (existing.status === 'ACCEPTED') throw new BadRequestException('Accepted quotations cannot be edited');

    let itemsData = undefined as any;
    let totals = {} as any;
    if (dto.items) {
      const built = this.buildItems(dto.items);
      totals = calcDocTotals(
        built.map((b) => b._totals),
        dto.discountType ?? (existing.discountType as any),
        dto.discountValue ?? Number(existing.discountValue),
      );
      itemsData = { deleteMany: {}, create: built.map(({ _totals, ...item }) => item) };
    }
    const q = await this.prisma.quotation.update({
      where: { id },
      data: {
        clientId: dto.clientId,
        status: dto.status,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        notes: dto.notes,
        ...totals,
        ...(itemsData ? { items: itemsData } : {}),
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'UPDATE', 'Quotation', id);
    return q;
  }

  /** Convert an accepted quotation into a sales order. */
  async convertToOrder(userId: string, id: string, warehouseId: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include: { items: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status === 'CANCELLED' || q.status === 'EXPIRED')
      throw new BadRequestException(`Cannot convert a ${q.status.toLowerCase()} quotation`);

    const number = await this.numbering.next('SALES_ORDER');
    const order = await this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: {
          number,
          clientId: q.clientId,
          quotationId: q.id,
          warehouseId,
          status: 'PENDING',
          discountType: q.discountType,
          discountValue: q.discountValue,
          subtotal: q.subtotal,
          taxAmount: q.taxAmount,
          total: q.total,
          notes: q.notes,
          createdById: userId,
          items: {
            create: q.items.map((i) => ({
              productId: i.productId,
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              discountType: i.discountType,
              discountValue: i.discountValue,
              taxRatePct: i.taxRatePct,
              lineTotal: i.lineTotal,
            })),
          },
        },
        include: { items: true },
      });
      await tx.quotation.update({ where: { id }, data: { status: 'ACCEPTED' } });
      return so;
    });
    await this.audit.log(userId, 'CONVERT_TO_ORDER', 'Quotation', id, { salesOrderNumber: order.number });
    return order;
  }

  async remove(userId: string, id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include: { salesOrders: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.salesOrders.length) throw new BadRequestException('Quotation is linked to a sales order');
    await this.prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Quotation', id);
    return { success: true };
  }
}
