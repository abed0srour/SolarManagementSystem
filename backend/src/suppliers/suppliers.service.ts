import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  async findAll(query: { search?: string; sortBy?: string; sortDir?: string; page?: number; pageSize?: number; archived?: string }) {
    // `archived=true` shows the archive instead of the active list — the
    // same query, with the soft-delete filter inverted.
    const where: Prisma.SupplierWhereInput = query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
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

    // What we still owe each supplier = unpaid remainder of their purchase orders
    const ids = items.map((s) => s.id);
    const payables = await this.prisma.purchaseOrder.groupBy({
      by: ['supplierId'],
      where: { supplierId: { in: ids }, status: { not: 'CANCELLED' }, deletedAt: null },
      _sum: { total: true, paidAmount: true },
    });
    const payableMap = new Map(
      payables.map((g) => [g.supplierId, Math.max(0, Number(g._sum.total ?? 0) - Number(g._sum.paidAmount ?? 0))]),
    );
    return {
      items: items.map((s) => ({ ...s, outstandingPayable: payableMap.get(s.id) ?? 0 })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ relationLoadStrategy: 'join',
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

  /**
   * Delete a supplier: permanently when nothing was ever bought from them,
   * otherwise archived so purchase history stays intact.
   *
   * `supplierProducts` (agreed price list) is excluded on purpose — it is
   * bookkeeping the admin can attach without any trade taking place, and it
   * cascades with the supplier. See `common/safe-delete.ts`.
   */
  private async supplierUsage(id: string) {
    const [purchaseOrders, invoices, payments, supplierReturns] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where: { supplierId: id } }),
      this.prisma.invoice.count({ where: { supplierId: id } }),
      this.prisma.payment.count({ where: { supplierId: id } }),
      this.prisma.supplierReturn.count({ where: { supplierId: id } }),
    ]);
    return { purchaseOrders, invoices, payments, supplierReturns };
  }

  /**
   * Bring an archived supplier back into active use. Archiving only sets
   * `deletedAt` and clears `isActive`, so restoring is the exact inverse:
   * nothing was destroyed, and every document that referenced it still does.
   */
  async restore(userId: string, id: string) {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Supplier not found');
    if (!row.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Supplier', id);
    return { success: true, alreadyActive: false };
  }

  /** Can this be deleted outright? `remove()` re-checks server-side. */
  async usage(id: string): Promise<UsageReport> {
    const counts = await this.supplierUsage(id);
    return { used: !isUnused(counts), usedBy: usedBy(counts) };
  }

  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const counts = await this.supplierUsage(id);

    if (isUnused(counts)) {
      await this.prisma.supplier.delete({ where: { id } });
      await this.audit.log(userId, 'PURGE', 'Supplier', id);
      return { success: true, mode: 'PURGED', usedBy: {} };
    }
    const used = usedBy(counts);
    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Supplier', id, { usedBy: used });
    return { success: true, mode: 'ARCHIVED', usedBy: used };
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
    return this.prisma.supplierReturn.findMany({ relationLoadStrategy: 'join',
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
