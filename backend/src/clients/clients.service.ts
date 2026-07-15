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

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        include: { addresses: true },
        orderBy: {
          [['name', 'createdAt', 'creditLimit', 'tier'].includes(query.sortBy ?? '') ? query.sortBy! : 'name']:
            query.sortDir === 'desc' ? 'desc' : 'asc',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.count({ where }),
    ]);

    // outstanding balance = sum of unpaid portions of sale invoices
    const ids = items.map((c) => c.id);
    const invoices = await this.prisma.invoice.groupBy({
      by: ['clientId'],
      where: { clientId: { in: ids }, type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
      _sum: { total: true, paidAmount: true },
    });
    const balanceMap = new Map(
      invoices.map((g) => [g.clientId, Number(g._sum.total ?? 0) - Number(g._sum.paidAmount ?? 0)]),
    );
    return {
      items: items.map((c) => ({ ...c, outstandingBalance: balanceMap.get(c.id) ?? 0 })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
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
    return this.prisma.client.findUnique({ where: { id }, include: { addresses: true } });
  }

  /** Soft delete — history (invoices, payments) stays intact. */
  async remove(userId: string, id: string) {
    await this.prisma.client.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Client', id);
    return { success: true };
  }
}
