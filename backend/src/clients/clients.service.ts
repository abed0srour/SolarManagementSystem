import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(query: { search?: string; type?: string; tier?: string; sortBy?: string; sortDir?: string; page?: number; pageSize?: number }) {
    const where: Prisma.ClientWhereInput = { deletedAt: null };
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

  /** Soft delete — history (invoices, payments) stays intact. */
  async remove(userId: string, id: string) {
    await this.prisma.client.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Client', id);
    return { success: true };
  }
}
