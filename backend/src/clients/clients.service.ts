import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';
import { InvoicePdfService } from '../invoices/invoice-pdf.service';

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private pdfService: InvoicePdfService,
  ) {}

  async getStatementData(id: string, options: { mode?: 'FULL' | 'PAYMENTS'; startDate?: Date; endDate?: Date } = {}) {
    return this.pdfService.getClientStatementData(id, options);
  }

  async generateStatementPdf(id: string, options: { mode?: 'FULL' | 'PAYMENTS'; startDate?: Date; endDate?: Date } = {}) {
    return this.pdfService.clientStatement(id, options);
  }


  async findAll(query: { search?: string; type?: string; tier?: string; sortBy?: string; sortDir?: string; page?: number; pageSize?: number; archived?: string }) {
    // `archived=true` shows the archive instead of the active list — the
    // same query, with the soft-delete filter inverted.
    const where: Prisma.ClientWhereInput = query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.type) where.type = query.type as any;
    if (query.tier) where.tier = query.tier as any;
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const sortDir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';

    /** balance = everything billed (non-cancelled sale invoices); paid; remaining = balance - paid */
    const statsFor = async (ids: string[]) => {
      const grouped = await this.prisma.invoice.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, type: 'SALE', status: { not: 'CANCELLED' }, deletedAt: null },
        _sum: { total: true, paidAmount: true },
      });
      return new Map(
        grouped.map((g) => {
          const billed = Number(g._sum.total ?? 0);
          const paid = Number(g._sum.paidAmount ?? 0);
          return [g.clientId, { billedTotal: billed, paidTotal: paid, outstandingBalance: billed - paid }] as const;
        }),
      );
    };
    const empty = { billedTotal: 0, paidTotal: 0, outstandingBalance: 0 };

    // "remaining" is computed, so it cannot be sorted in SQL — sort in memory.
    if (query.sortBy === 'remaining') {
      const all = await this.prisma.client.findMany({ relationLoadStrategy: 'join', where, include: { addresses: true } });
      const stats = await statsFor(all.map((c) => c.id));
      const enriched = all
        .map((c) => ({ ...c, ...(stats.get(c.id) ?? empty) }))
        .sort((a, b) => (sortDir === 'asc' ? a.outstandingBalance - b.outstandingBalance : b.outstandingBalance - a.outstandingBalance));
      return {
        items: enriched.slice((page - 1) * pageSize, page * pageSize),
        total: enriched.length,
        page,
        pageSize,
      };
    }

    const sortBy = ['name', 'createdAt', 'creditLimit', 'tier'].includes(query.sortBy ?? '') ? query.sortBy! : 'createdAt';
    const [items, total] = await Promise.all([
      this.prisma.client.findMany({ relationLoadStrategy: 'join',
        where,
        include: { addresses: true },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.count({ where }),
    ]);
    const stats = await statsFor(items.map((c) => c.id));
    return {
      items: items.map((c) => ({ ...c, ...(stats.get(c.id) ?? empty) })),
      total,
      page,
      pageSize,
    };
  }

  /** Lightweight profile for popups: basics + addresses + outstanding, no history lists. */
  async brief(id: string) {
    const [client, outstanding] = await Promise.all([
      this.prisma.client.findUnique({ relationLoadStrategy: 'join', where: { id }, include: { addresses: true } }),
      this.prisma.invoice.aggregate({
        where: { clientId: id, type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
        _sum: { total: true, paidAmount: true },
      }),
    ]);
    if (!client) throw new NotFoundException('Client not found');
    return {
      ...client,
      outstandingBalance: Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.paidAmount ?? 0),
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        addresses: true,
        invoices: { where: { type: 'SALE' }, orderBy: { issueDate: 'desc' }, take: 50 },
        quotations: { orderBy: { createdAt: 'desc' }, take: 20 },
        salesOrders: { orderBy: { createdAt: 'desc' }, take: 20 },
        payments: { orderBy: { paymentDate: 'desc' }, take: 30 },
        warrantyClaims: { orderBy: { openedAt: 'desc' }, take: 20 },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    const agg = await this.prisma.invoice.aggregate({
      where: { clientId: id, type: 'SALE', status: { not: 'CANCELLED' } },
      _sum: { total: true, paidAmount: true },
    });
    const outstanding = await this.prisma.invoice.aggregate({
      where: { clientId: id, type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
      _sum: { total: true, paidAmount: true },
    });
    return {
      ...client,
      lifetimeValue: Number(agg._sum.total ?? 0),
      outstandingBalance: Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.paidAmount ?? 0),
    };
  }

  async create(userId: string, data: any) {
    const { addresses, ...clientData } = data;
    const client = await this.prisma.client.create({
      data: {
        ...clientData,
        addresses: addresses?.length ? { create: addresses } : undefined,
      },
      include: { addresses: true },
    });
    await this.audit.log(userId, 'CREATE', 'Client', client.id, { name: client.name });
    return client;
  }

  async update(userId: string, id: string, data: any) {
    const { addresses, ...clientData } = data;
    const client = await this.prisma.client.update({
      where: { id },
      data: clientData,
    });
    if (addresses) {
      await this.prisma.clientAddress.deleteMany({ where: { clientId: id } });
      if (addresses.length) {
        await this.prisma.clientAddress.createMany({ data: addresses.map((a: any) => ({ ...a, clientId: id })) });
      }
    }
    await this.audit.log(userId, 'UPDATE', 'Client', id);
    return this.prisma.client.findUnique({ relationLoadStrategy: 'join', where: { id }, include: { addresses: true } });
  }

  /**
   * Delete a client: permanently when they have no history at all, otherwise
   * archived so invoices and payments keep resolving.
   *
   * `addresses` is excluded — it is captured on the client form itself, so a
   * client entered by mistake usually has one, and it cascades with the client.
   * See `common/safe-delete.ts`.
   */
  private async clientUsage(id: string) {
    const [quotations, salesOrders, invoices, payments, refunds, warrantyClaims, serviceJobs, installations] =
      await this.prisma.$transaction([
        this.prisma.quotation.count({ where: { clientId: id } }),
        this.prisma.salesOrder.count({ where: { clientId: id } }),
        this.prisma.invoice.count({ where: { clientId: id } }),
        this.prisma.payment.count({ where: { clientId: id } }),
        this.prisma.refund.count({ where: { clientId: id } }),
        this.prisma.warrantyClaim.count({ where: { clientId: id } }),
        this.prisma.serviceJob.count({ where: { clientId: id } }),
        this.prisma.installation.count({ where: { clientId: id } }),
      ]);
    return { quotations, salesOrders, invoices, payments, refunds, warrantyClaims, serviceJobs, installations };
  }

  /**
   * Bring an archived client back into active use. Archiving only sets
   * `deletedAt` and clears `isActive`, so restoring is the exact inverse:
   * nothing was destroyed, and every document that referenced it still does.
   */
  async restore(userId: string, id: string) {
    const row = await this.prisma.client.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Client not found');
    if (!row.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.client.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Client', id);
    return { success: true, alreadyActive: false };
  }

  /** Can this be deleted outright? `remove()` re-checks server-side. */
  async usage(id: string): Promise<UsageReport> {
    const counts = await this.clientUsage(id);
    return { used: !isUnused(counts), usedBy: usedBy(counts) };
  }

  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');

    const counts = await this.clientUsage(id);

    if (!isUnused(counts)) {
      const used = usedBy(counts);
      const parts: string[] = [];
      if (used.salesOrders) parts.push(`${used.salesOrders} sales order(s)`);
      if (used.invoices) parts.push(`${used.invoices} invoice(s)`);
      if (used.payments) parts.push(`${used.payments} payment(s)`);
      if (used.quotations) parts.push(`${used.quotations} quotation(s)`);
      if (used.installations) parts.push(`${used.installations} installation(s)`);
      if (used.warrantyClaims) parts.push(`${used.warrantyClaims} warranty claim(s)`);
      if (used.serviceJobs) parts.push(`${used.serviceJobs} service job(s)`);
      if (used.refunds) parts.push(`${used.refunds} refund(s)`);
      const details = parts.length > 0 ? parts.join(', ') : 'linked records';
      throw new BadRequestException(
        `Cannot delete client "${client.name}" because they have existing relations (${details}).`,
      );
    }

    await this.prisma.client.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'Client', id);
    return { success: true, mode: 'PURGED', usedBy: {} };
  }
}
