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
    const totalPromise = this.prisma.notification.count({ where });
    return this.prisma.notification
      .findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
      .then(async (items) => ({
        items,
        total: await totalPromise,
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

  async deleteNotification(id: string) {
    await this.prisma.notification.deleteMany({ where: { id } });
    return { success: true };
  }

  async clearAll() {
    await this.prisma.notification.deleteMany({});
    return { success: true };
  }

  /**
   * Make the stored notifications for one (type, entity) match the conditions
   * that are true right now.
   *
   * Creates what is missing, deletes what no longer applies, and leaves
   * everything else alone — including alerts the user has already read. That
   * last part is the point: deduping on `isRead` meant a seen alert was
   * recreated on the next run while its condition still held.
   *
   * Deleting on resolution is what keeps recurrence working. A product that
   * goes low, is acknowledged, is restocked and later goes low again gets a
   * fresh notification, because the row was cleared in between.
   */
  private async syncNotifications(
    type: NotificationType,
    entity: string,
    active: { id: string; message: string }[],
  ) {
    const activeIds = active.map((a) => a.id);

    await this.prisma.notification.deleteMany({
      where: { type, entity, ...(activeIds.length ? { entityId: { notIn: activeIds } } : {}) },
    });
    if (!activeIds.length) return;

    const existing = await this.prisma.notification.findMany({
      where: { type, entity, entityId: { in: activeIds } },
      select: { entityId: true },
    });
    const known = new Set(existing.map((e) => e.entityId));
    const missing = active.filter((a) => !known.has(a.id));
    if (missing.length) {
      await this.prisma.notification.createMany({
        data: missing.map((a) => ({ type, entity, entityId: a.id, message: a.message })),
      });
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
    const low = products.flatMap((p) => {
      const qty = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
      return qty <= p.lowStockThreshold
        ? [{ id: p.id, message: `Low stock: ${p.name} [${p.sku}] — ${qty} left (threshold ${p.lowStockThreshold})` }]
        : [];
    });
    await this.syncNotifications('LOW_STOCK', 'Product', low);
  }

  async checkOverduePayments() {
    const now = new Date();
    // Overdue invoices
    const overdue = await this.prisma.invoice.findMany({ relationLoadStrategy: 'join',
      where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
      include: { client: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    for (const inv of overdue) {
      await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'OVERDUE' } });
    }
    await this.syncNotifications(
      'PAYMENT_OVERDUE',
      'Invoice',
      overdue.map((inv) => ({
        id: inv.id,
        message: `Invoice ${inv.number} (${inv.client?.name ?? inv.supplier?.name ?? ''}) is overdue — balance ${(Number(inv.total) - Number(inv.paidAmount)).toFixed(2)}`,
      })),
    );
    // Overdue installments
    const schedules = await this.prisma.paymentSchedule.findMany({ relationLoadStrategy: 'join',
      where: { status: 'PENDING', dueDate: { lt: now } },
      include: { invoice: { include: { client: { select: { name: true } } } } },
    });
    for (const sched of schedules) {
      await this.prisma.paymentSchedule.update({ where: { id: sched.id }, data: { status: 'OVERDUE' } });
    }
    await this.syncNotifications(
      'PAYMENT_OVERDUE',
      'PaymentSchedule',
      schedules.map((sched) => ({
        id: sched.id,
        message: `Installment ${sched.installmentNo} of invoice ${sched.invoice.number} (${sched.invoice.client?.name ?? ''}) is overdue — ${Number(sched.amount).toFixed(2)}`,
      })),
    );
    // Due within 3 days
    const soon = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    const dueSoon = await this.prisma.paymentSchedule.findMany({ relationLoadStrategy: 'join',
      where: { status: 'PENDING', dueDate: { gte: now, lte: soon } },
      include: { invoice: { include: { client: { select: { name: true } } } } },
    });
    await this.syncNotifications(
      'PAYMENT_DUE',
      'PaymentSchedule',
      dueSoon.map((sched) => ({
        id: sched.id,
        message: `Installment ${sched.installmentNo} of invoice ${sched.invoice.number} (${sched.invoice.client?.name ?? ''}) due ${sched.dueDate.toISOString().slice(0, 10)}`,
      })),
    );
  }

  async checkExpiringQuotations() {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    const expiring = await this.prisma.quotation.findMany({ relationLoadStrategy: 'join',
      where: { status: 'SENT', validUntil: { gte: now, lte: soon } },
      include: { client: { select: { name: true } } },
    });
    await this.syncNotifications(
      'QUOTATION_EXPIRING',
      'Quotation',
      expiring.map((q) => ({
        id: q.id,
        message: `Quotation ${q.number} for ${q.client.name} expires ${q.validUntil!.toISOString().slice(0, 10)}`,
      })),
    );
    // Auto-expire past quotations
    await this.prisma.quotation.updateMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: now } },
      data: { status: 'EXPIRED' },
    });
  }

  async checkExpiringWarranties() {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const units = await this.prisma.productUnit.findMany({ relationLoadStrategy: 'join',
      where: { status: 'SOLD', warrantyEndDate: { gte: now, lte: soon } },
      include: { product: { select: { name: true } } },
    });
    await this.syncNotifications(
      'WARRANTY_EXPIRING',
      'ProductUnit',
      units.map((u) => ({
        id: u.id,
        message: `Warranty for ${u.product.name} (SN ${u.serialNumber}) expires ${u.warrantyEndDate!.toISOString().slice(0, 10)}`,
      })),
    );
  }

  /** Lead-acid shelf-life: manufacture date + shelfLifeMonths approaching for units still in stock. */
  async checkShelfLife() {
    const units = await this.prisma.productUnit.findMany({ relationLoadStrategy: 'join',
      where: { status: 'IN_STOCK', manufactureDate: { not: null }, product: { shelfLifeMonths: { not: null } } },
      include: { product: { select: { name: true, shelfLifeMonths: true } } },
    });
    const now = new Date();
    const soonMs = 30 * 24 * 3600 * 1000;
    const expiring = units.flatMap((u) => {
      const expiry = new Date(u.manufactureDate!);
      expiry.setMonth(expiry.getMonth() + (u.product.shelfLifeMonths ?? 0));
      return expiry.getTime() - now.getTime() <= soonMs
        ? [{
            id: u.id,
            message: `Shelf life alert: ${u.product.name} (SN ${u.serialNumber}) expires ${expiry.toISOString().slice(0, 10)} — sell or rotate stock`,
          }]
        : [];
    });
    await this.syncNotifications('SHELF_LIFE_ALERT', 'ProductUnit', expiring);
  }
}
