import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { calcDocTotals, calcLine } from '../common/calc';
import { BuiltLine, buildCompositeItems, writeSubItems } from '../common/composite-items';
import { SafeDeleteResult, UsageReport, isUnused, usedBy } from '../common/safe-delete';

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { search?: string; status?: string; clientId?: string; page?: number; pageSize?: number; archived?: string }) {
    // `archived=true` shows the archive instead of the active list.
    const where: Prisma.QuotationWhereInput =
      query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
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
    const totalPromise = this.prisma.quotation.count({ where });
    return this.prisma.quotation
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: { client: { select: { id: true, name: true, phone: true } }, items: { where: { parentItemId: null } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const q = await this.prisma.quotation.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: { include: { addresses: true } },
        // Components hang off their parent, so the top level is the document as
        // the customer reads it — a bundle is one priced line, not its parts.
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true } },
            subItems: { include: { product: { select: { sku: true, name: true } } } },
          },
        },
        salesOrders: { select: { id: true, number: true, status: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  private buildItems(items: any[]) {
    return buildCompositeItems(this.prisma, items);
  }

  async create(userId: string, dto: any) {
    const built = await this.buildItems(dto.items);
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
        items: { create: built.map(({ _totals, _subItems, ...item }) => item) },
      },
      include: { items: true },
    });
    await writeSubItems(this.prisma.quotationItem, 'quotationId', q.id, built);
    await this.audit.log(userId, 'CREATE', 'Quotation', q.id, { number });
    return q;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (existing.status === 'ACCEPTED') throw new BadRequestException('Accepted quotations cannot be edited');

    let itemsData = undefined as any;
    let totals = {} as any;
    let built: BuiltLine[] = [];
    if (dto.items) {
      built = await this.buildItems(dto.items);
      totals = calcDocTotals(
        built.map((b) => b._totals),
        dto.discountType ?? (existing.discountType as any),
        dto.discountValue ?? Number(existing.discountValue),
      );
      itemsData = { deleteMany: {}, create: built.map(({ _totals, _subItems, ...item }) => item) };
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
    if (itemsData) await writeSubItems(this.prisma.quotationItem, 'quotationId', id, built);
    await this.audit.log(userId, 'UPDATE', 'Quotation', id);
    return q;
  }

  /** Convert an accepted quotation into a sales order. */
  async convertToOrder(userId: string, id: string, warehouseId: string) {
    const q = await this.prisma.quotation.findUnique({
      relationLoadStrategy: 'join',
      where: { id },
      // Only the top level, with components nested — a flat copy would turn every
      // bundle component into its own priced order line and double the total.
      include: { items: { where: { parentItemId: null }, include: { subItems: true } } },
    });
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
          total: q.total,
          notes: q.notes,
          createdById: userId,
          items: {
            create: q.items.map((i) => ({
              productId: i.productId,
              description: i.description,
              quantity: i.quantity,
              unit: i.unit,
              unitPrice: i.unitPrice,
              discountType: i.discountType,
              discountValue: i.discountValue,
              lineTotal: i.lineTotal,
              isComposite: i.isComposite,
              autoPrice: i.autoPrice,
            })),
          },
        },
        include: { items: true },
      });

      // Components are attached after the parents exist, so each child can point
      // at its parent's id — the same two-step the create/update paths use.
      await writeSubItems(
        tx.salesOrderItem,
        'salesOrderId',
        so.id,
        q.items.map((i) => ({
          description: i.description,
          _subItems: i.subItems.map((s) => ({
            productId: s.productId,
            description: s.description!,
            quantity: Number(s.quantity),
            unit: s.unit,
            unitPrice: Number(s.unitPrice),
            lineTotal: Number(s.lineTotal),
          })),
        })) as BuiltLine[],
      );
      await tx.quotation.update({ where: { id }, data: { status: 'ACCEPTED' } });
      return so;
    });
    await this.audit.log(userId, 'CONVERT_TO_ORDER', 'Quotation', id, { salesOrderNumber: order.number });
    return order;
  }

  /**
   * Business use of a quotation. A quotation the customer accepted or rejected
   * is a record of a decision, so it is archived rather than deleted even though
   * nothing points at it in the database.
   */
  private async quotationUsage(id: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      select: { status: true, _count: { select: { salesOrders: true } } },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return {
      counts: {
        salesOrders: q._count.salesOrders,
        // The only status that records a customer decision worth keeping.
        // A draft, an expired or a cancelled quotation is just a dead draft.
        accepted: q.status === 'ACCEPTED' ? 1 : 0,
      },
      salesOrders: q._count.salesOrders,
    };
  }

  /** Can this quotation be deleted outright? `remove()` re-checks server-side. */
  async usage(id: string): Promise<UsageReport> {
    const { counts, salesOrders } = await this.quotationUsage(id);
    return {
      used: !isUnused(counts),
      usedBy: usedBy(counts),
      // A converted quotation is the paper trail behind a real order, so it is
      // never removed — not even archived — while that order exists.
      blockedReason: salesOrders > 0 ? 'HAS_SALES_ORDER' : undefined,
    };
  }

  /**
   * Delete a quotation: permanently when it was never converted or accepted,
   * otherwise archived. See `common/safe-delete.ts`.
   */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const q = await this.prisma.quotation.findUnique({ relationLoadStrategy: 'join', where: { id }, include: { salesOrders: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.salesOrders.length) throw new BadRequestException('Quotation is linked to a sales order');

    const { counts } = await this.quotationUsage(id);
    if (!isUnused(counts)) {
      const used = usedBy(counts);
      const parts = Object.entries(used).map(([k, v]) => `${v} ${k}`);
      throw new BadRequestException(
        `Cannot delete quotation "${q.number}" because it has existing relations (${parts.join(', ')}).`,
      );
    }

    // Items cascade with the quotation.
    await this.prisma.quotation.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'Quotation', id, { number: q.number });
    return { success: true, mode: 'PURGED', usedBy: {} };
  }

  /** Bring an archived quotation back into the active list. */
  async restore(userId: string, id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (!q.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.quotation.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log(userId, 'RESTORE', 'Quotation', id, { number: q.number });
    return { success: true, alreadyActive: false };
  }
}
