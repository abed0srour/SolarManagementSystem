import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  findAll(query: { unreadOnly?: string; page?: number; pageSize?: number }) {
    const where = query.unreadOnly === 'true' ? { isRead: false } : {};
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 30, 200);
    return this.prisma.notification
      .findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
      .then(async (items) => ({
        items,
        total: await this.prisma.notification.count({ where }),
        unread: await this.prisma.notification.count({ where: { isRead: false } }),
        page,
        pageSize,
      }));
  }

  markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead() {
    await this.prisma.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
    return { success: true };
  }

  /** Avoid duplicate open notifications for the same entity+type. */
  private async notifyOnce(type: NotificationType, message: string, entity: string, entityId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { type, entity, entityId, isRead: false },
    });
    if (!existing) {
      await this.prisma.notification.create({ data: { type, message, entity, entityId } });
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runChecks() {
    try {
      await this.checkLowStock();
      await this.checkOverduePayments();
      await this.checkExpiringQuotations();
      await this.checkExpiringWarranties();
      await this.checkShelfLife();
    } catch (e) {
      this.logger.error('Notification checks failed', e as any);
    }
  }

  async checkLowStock() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
    });
    for (const p of products) {
      const qty = p.stockLevels.reduce((s, l) => s + l.quantity, 0);
      if (qty <= p.lowStockThreshold) {
        await this.notifyOnce('LOW_STOCK', `Low stock: ${p.name} [${p.sku}] — ${qty} left (threshold ${p.lowStockThreshold})`, 'Product', p.id);
      }
    }
  }

  async checkOverduePayments() {
    const now = new Date();
    // Overdue invoices
    const overdue = await this.prisma.invoice.findMany({
      where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
      include: { client: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    for (const inv of overdue) {
      await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'OVERDUE' } });
      const party = inv.client?.name ?? inv.supplier?.name ?? '';
      await this.notifyOnce('PAYMENT_OVERDUE', `Invoice ${inv.number} (${party}) is overdue — balance ${(Number(inv.total) - Number(inv.paidAmount)).toFixed(2)}`, 'Invoice', inv.id);
    }
    // Overdue installments
    const schedules = await this.prisma.paymentSchedule.findMany({
      where: { status: 'PENDING', dueDate: { lt: now } },
      include: { invoice: { include: { client: { select: { name: true } } } } },
    });
    for (const s of schedules) {
      await this.prisma.paymentSchedule.update({ where: { id: s.id }, data: { status: 'OVERDUE' } });
      await this.notifyOnce('PAYMENT_OVERDUE', `Installment ${s.installmentNo} of invoice ${s.invoice.number} (${s.invoice.client?.name ?? ''}) is overdue — ${Number(s.amount).toFixed(2)}`, 'PaymentSchedule', s.id);
    }
    // Due within 3 days
    const soon = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    const dueSoon = await this.prisma.paymentSchedule.findMany({
      where: { status: 'PENDING', dueDate: { gte: now, lte: soon } },
      include: { invoice: { include: { client: { select: { name: true } } } } },
    });
    for (const s of dueSoon) {
      await this.notifyOnce('PAYMENT_DUE', `Installment ${s.installmentNo} of invoice ${s.invoice.number} (${s.invoice.client?.name ?? ''}) due ${s.dueDate.toISOString().slice(0, 10)}`, 'PaymentSchedule', s.id);
    }
  }

  async checkExpiringQuotations() {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    const expiring = await this.prisma.quotation.findMany({
      where: { status: 'SENT', validUntil: { gte: now, lte: soon } },
      include: { client: { select: { name: true } } },
    });
    for (const q of expiring) {
      await this.notifyOnce('QUOTATION_EXPIRING', `Quotation ${q.number} for ${q.client.name} expires ${q.validUntil!.toISOString().slice(0, 10)}`, 'Quotation', q.id);
    }
    // Auto-expire past quotations
    await this.prisma.quotation.updateMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: now } },
      data: { status: 'EXPIRED' },
    });
  }

  async checkExpiringWarranties() {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const units = await this.prisma.productUnit.findMany({
      where: { status: 'SOLD', warrantyEndDate: { gte: now, lte: soon } },
      include: { product: { select: { name: true } } },
    });
    for (const u of units) {
      await this.notifyOnce('WARRANTY_EXPIRING', `Warranty for ${u.product.name} (SN ${u.serialNumber}) expires ${u.warrantyEndDate!.toISOString().slice(0, 10)}`, 'ProductUnit', u.id);
    }
  }

  /** Lead-acid shelf-life: manufacture date + shelfLifeMonths approaching for units still in stock. */
  async checkShelfLife() {
    const units = await this.prisma.productUnit.findMany({
      where: { status: 'IN_STOCK', manufactureDate: { not: null }, product: { shelfLifeMonths: { not: null } } },
      include: { product: { select: { name: true, shelfLifeMonths: true } } },
    });
    const now = new Date();
    const soonMs = 30 * 24 * 3600 * 1000;
    for (const u of units) {
      const expiry = new Date(u.manufactureDate!);
      expiry.setMonth(expiry.getMonth() + (u.product.shelfLifeMonths ?? 0));
      if (expiry.getTime() - now.getTime() <= soonMs) {
        await this.notifyOnce('SHELF_LIFE_ALERT', `Shelf life alert: ${u.product.name} (SN ${u.serialNumber}) expires ${expiry.toISOString().slice(0, 10)} — sell or rotate stock`, 'ProductUnit', u.id);
      }
    }
  }
}
