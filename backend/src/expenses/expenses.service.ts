import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { round2 } from '../common/calc';
import { SafeDeleteResult } from '../common/safe-delete';

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { category?: string; from?: string; to?: string; search?: string; page?: number; pageSize?: number; archived?: string }) {
    // `archived=true` shows the archive instead of the active list.
    const where: Prisma.ExpenseWhereInput =
      query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    if (query.category) where.category = query.category as any;
    if (query.from || query.to) {
      where.expenseDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(new Date(query.to).setHours(23, 59, 59, 999)) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { vendor: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.expense.count({ where });
    return this.prisma.expense
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: { createdBy: { select: { name: true } } },
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async summary(from?: string, to?: string) {
    const gte = from ? new Date(from) : new Date(Date.now() - 365 * 24 * 3600 * 1000);
    const lte = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date();
    const where: Prisma.ExpenseWhereInput = { deletedAt: null, expenseDate: { gte, lte } };

    const byCategory = await this.prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: true });
    const rows = await this.prisma.expense.findMany({ where, select: { expenseDate: true, amount: true } });
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      const key = r.expenseDate.toISOString().slice(0, 7);
      byMonth.set(key, round2((byMonth.get(key) ?? 0) + Number(r.amount)));
    }
    const total = round2(rows.reduce((s, r) => s + Number(r.amount), 0));
    return {
      total,
      byCategory: byCategory
        .map((c) => ({ category: c.category, count: c._count, total: Number(c._sum.amount ?? 0) }))
        .sort((a, b) => b.total - a.total),
      byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })),
    };
  }

  async create(userId: string, dto: any) {
    const number = await this.numbering.next('EXPENSE');
    const expense = await this.prisma.expense.create({
      data: {
        number,
        category: dto.category ?? 'OTHER',
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'USD',
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
        vendor: dto.vendor,
        paymentMethod: dto.paymentMethod ?? 'CASH',
        reference: dto.reference,
        notes: dto.notes,
        createdById: userId,
      },
    });
    await this.audit.log(userId, 'CREATE', 'Expense', expense.id, { number, amount: dto.amount });
    return expense;
  }

  async update(userId: string, id: string, dto: any) {
    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        vendor: dto.vendor,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference,
        notes: dto.notes,
      },
    });
    await this.audit.log(userId, 'UPDATE', 'Expense', id, dto);
    return expense;
  }

  /**
   * Expenses are always archived, never purged.
   *
   * Nothing in the database points at an expense, so the usual "nothing
   * references it, delete it for real" rule would purge every one. But an
   * expense is money that actually left the business, and reports already
   * exclude archived rows — so archiving costs nothing in the numbers and buys
   * back a wrong deletion, which purging cannot.
   */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Expense', id, { number: expense.number });
    return { success: true, mode: 'ARCHIVED', usedBy: {} };
  }

  /** Bring an archived expense back into the active list — and back into reports. */
  async restore(userId: string, id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    if (!expense.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log(userId, 'RESTORE', 'Expense', id, { number: expense.number });
    return { success: true, alreadyActive: false };
  }
}
