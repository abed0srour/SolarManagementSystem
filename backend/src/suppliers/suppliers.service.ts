import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  async findAll(query: { search?: string; sortBy?: string; sortDir?: string; page?: number; pageSize?: number }) {
    const where: Prisma.SupplierWhereInput = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { contactName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: {
          [['name', 'createdAt', 'leadTimeDays'].includes(query.sortBy ?? '') ? query.sortBy! : 'name']:
            query.sortDir === 'desc' ? 'desc' : 'asc',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    const ids = items.map((s) => s.id);
    const payables = await this.prisma.invoice.groupBy({
      by: ['supplierId'],
      where: { supplierId: { in: ids }, type: 'PURCHASE', status: { notIn: ['CANCELLED', 'PAID'] } },
      _sum: { total: true, paidAmount: true },
    });
    const payableMap = new Map(
      payables.map((g) => [g.supplierId, Number(g._sum.total ?? 0) - Number(g._sum.paidAmount ?? 0)]),
    );
    return {
      items: items.map((s) => ({ ...s, outstandingPayable: payableMap.get(s.id) ?? 0 })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { include: { product: { select: { id: true, sku: true, name: true, costPrice: true } } } },
        purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 20 },
        invoices: { where: { type: 'PURCHASE' }, orderBy: { issueDate: 'desc' }, take: 30 },
        payments: { orderBy: { paymentDate: 'desc' }, take: 30 },
        supplierReturns: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const outstanding = await this.prisma.invoice.aggregate({
      where: { supplierId: id, type: 'PURCHASE', status: { notIn: ['CANCELLED', 'PAID'] } },
      _sum: { total: true, paidAmount: true },
    });
    return {
      ...supplier,
      outstandingPayable: Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.paidAmount ?? 0),
    };
  }

  async create(userId: string, data: any) {
    const supplier = await this.prisma.supplier.create({ data });
    await this.audit.log(userId, 'CREATE', 'Supplier', supplier.id, { name: supplier.name });
    return supplier;
  }

  async update(userId: string, id: string, data: any) {
    const supplier = await this.prisma.supplier.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'Supplier', id);
    return supplier;
  }

  /** Soft delete — purchase history stays intact. */
  async remove(userId: string, id: string) {
    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Supplier', id);
    return { success: true };
  }

  async setSupplierPrice(userId: string, supplierId: string, productId: string, supplierPrice: number, currency = 'USD') {
    const sp = await this.prisma.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId, productId } },
      update: { supplierPrice, currency },
      create: { supplierId, productId, supplierPrice, currency },
    });
    await this.audit.log(userId, 'SET_SUPPLIER_PRICE', 'SupplierProduct', sp.id, { supplierId, productId, supplierPrice });
    return sp;
  }

  async removeSupplierPrice(userId: string, id: string) {
    await this.prisma.supplierProduct.delete({ where: { id } });
    await this.audit.log(userId, 'DELETE', 'SupplierProduct', id);
    return { success: true };
  }

  // ---- Supplier returns ----

  supplierReturns(query: { supplierId?: string }) {
    return this.prisma.supplierReturn.findMany({
      where: query.supplierId ? { supplierId: query.supplierId } : undefined,
      include: { supplier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSupplierReturn(userId: string, data: { supplierId: string; items: any[]; notes?: string }) {
    const number = await this.numbering.next('SUPPLIER_RETURN');
    const ret = await this.prisma.supplierReturn.create({
      data: { number, supplierId: data.supplierId, items: data.items, notes: data.notes },
    });
    await this.audit.log(userId, 'CREATE', 'SupplierReturn', ret.id, { number });
    return ret;
  }

  async updateSupplierReturn(userId: string, id: string, data: { status?: any; creditNoteRef?: string; notes?: string }) {
    const ret = await this.prisma.supplierReturn.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'SupplierReturn', id, data);
    return ret;
  }
}
