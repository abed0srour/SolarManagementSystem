import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/calc';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private range(from?: string, to?: string) {
    const gte = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const lte = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date();
    return { gte, lte };
  }

  /** Main dashboard: KPIs + charts data. */
  async dashboard(from?: string, to?: string) {
    const period = this.range(from, to);
    const saleWhere = { type: 'SALE' as const, status: { not: 'CANCELLED' as const }, issueDate: period };

    const [salesAgg, receivables, payables, invoiceCount, openClaims, pendingOrders] = await Promise.all([
      this.prisma.invoice.aggregate({ where: saleWhere, _sum: { total: true, paidAmount: true } }),
      this.prisma.invoice.aggregate({
        where: { type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
        _sum: { total: true, paidAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where: { type: 'PURCHASE', status: { notIn: ['CANCELLED', 'PAID'] } },
        _sum: { total: true, paidAmount: true },
      }),
      this.prisma.invoice.count({ where: saleWhere }),
      this.prisma.warrantyClaim.count({ where: { status: { in: ['OPEN', 'SENT_TO_SUPPLIER'] } } }),
      this.prisma.salesOrder.count({ where: { status: 'PENDING' } }),
    ]);

    // Sales by day (for chart)
    const invoices = await this.prisma.invoice.findMany({
      where: saleWhere,
      select: { issueDate: true, total: true },
      orderBy: { issueDate: 'asc' },
    });
    const byDay = new Map<string, number>();
    for (const inv of invoices) {
      const day = inv.issueDate.toISOString().slice(0, 10);
      byDay.set(day, round2((byDay.get(day) ?? 0) + Number(inv.total)));
    }

    // Sales by category
    const saleItems = await this.prisma.invoiceItem.findMany({
      where: { invoice: saleWhere, productId: { not: null } },
      include: { product: { include: { subCategory: { include: { category: true } } } } },
    });
    const byCategory = new Map<string, number>();
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    let cogs = 0;
    for (const item of saleItems) {
      const cat = item.product?.subCategory.category.name ?? 'Other';
      byCategory.set(cat, round2((byCategory.get(cat) ?? 0) + Number(item.lineTotal)));
      const key = item.product!.sku;
      const cur = byProduct.get(key) ?? { name: item.product!.name, qty: 0, revenue: 0 };
      cur.qty += item.quantity;
      cur.revenue = round2(cur.revenue + Number(item.lineTotal));
      byProduct.set(key, cur);
      cogs += Number(item.product!.costPrice) * item.quantity;
    }
    const revenue = Number(salesAgg._sum.total ?? 0);

    // Low stock count
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
    });
    const lowStockCount = products.filter(
      (p) => p.stockLevels.reduce((s, l) => s + l.quantity, 0) <= p.lowStockThreshold,
    ).length;

    return {
      kpis: {
        revenue,
        collected: Number(salesAgg._sum.paidAmount ?? 0),
        grossProfit: round2(revenue - cogs),
        invoiceCount,
        accountsReceivable: round2(Number(receivables._sum.total ?? 0) - Number(receivables._sum.paidAmount ?? 0)),
        accountsPayable: round2(Number(payables._sum.total ?? 0) - Number(payables._sum.paidAmount ?? 0)),
        openClaims,
        pendingOrders,
        lowStockCount,
      },
      salesByDay: [...byDay.entries()].map(([date, total]) => ({ date, total })),
      salesByCategory: [...byCategory.entries()].map(([category, total]) => ({ category, total })),
      topProducts: [...byProduct.entries()]
        .map(([sku, v]) => ({ sku, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
    };
  }

  /** Profit margin per product over a period. */
  async profitByProduct(from?: string, to?: string) {
    const period = this.range(from, to);
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { type: 'SALE', status: { not: 'CANCELLED' }, issueDate: period }, productId: { not: null } },
      include: { product: { select: { sku: true, name: true, costPrice: true } } },
    });
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const i of items) {
      const cur = map.get(i.product!.sku) ?? { name: i.product!.name, qty: 0, revenue: 0, cost: 0 };
      cur.qty += i.quantity;
      cur.revenue = round2(cur.revenue + Number(i.lineTotal));
      cur.cost = round2(cur.cost + Number(i.product!.costPrice) * i.quantity);
      map.set(i.product!.sku, cur);
    }
    return [...map.entries()]
      .map(([sku, v]) => ({
        sku,
        ...v,
        profit: round2(v.revenue - v.cost),
        marginPct: v.revenue ? round2(((v.revenue - v.cost) / v.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }

  /** Inventory valuation at cost and at sale price. */
  async inventoryValuation() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        sku: true,
        name: true,
        costPrice: true,
        salePrice: true,
        subCategory: { select: { name: true, category: { select: { name: true } } } },
        stockLevels: { select: { quantity: true } },
      },
    });
    const rows = products.map((p) => {
      const qty = p.stockLevels.reduce((s, l) => s + l.quantity, 0);
      return {
        sku: p.sku,
        name: p.name,
        category: p.subCategory.category.name,
        subCategory: p.subCategory.name,
        quantity: qty,
        costValue: round2(qty * Number(p.costPrice)),
        saleValue: round2(qty * Number(p.salePrice)),
      };
    });
    return {
      rows,
      totalCostValue: round2(rows.reduce((s, r) => s + r.costValue, 0)),
      totalSaleValue: round2(rows.reduce((s, r) => s + r.saleValue, 0)),
    };
  }

  /** Accounts receivable: open sale invoices with aging bucket. */
  async receivables() {
    const invoices = await this.prisma.invoice.findMany({
      where: { type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const now = Date.now();
    return invoices.map((inv) => {
      const balance = round2(Number(inv.total) - Number(inv.paidAmount));
      const daysOverdue = inv.dueDate ? Math.max(0, Math.floor((now - inv.dueDate.getTime()) / 86400000)) : 0;
      const bucket = daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
      return { id: inv.id, number: inv.number, client: inv.client?.name, dueDate: inv.dueDate, total: inv.total, paidAmount: inv.paidAmount, balance, daysOverdue, bucket };
    });
  }

  /** Accounts payable: open purchase invoices. */
  async payables() {
    const invoices = await this.prisma.invoice.findMany({
      where: { type: 'PURCHASE', status: { notIn: ['CANCELLED', 'PAID'] } },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    return invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      supplier: inv.supplier?.name,
      dueDate: inv.dueDate,
      total: inv.total,
      paidAmount: inv.paidAmount,
      balance: round2(Number(inv.total) - Number(inv.paidAmount)),
    }));
  }

  /** Cash flow: payments in/out per day over a period. */
  async cashFlow(from?: string, to?: string) {
    const period = this.range(from, to);
    const payments = await this.prisma.payment.findMany({
      where: { paymentDate: period },
      select: { direction: true, amount: true, paymentDate: true, method: true },
      orderBy: { paymentDate: 'asc' },
    });
    const byDay = new Map<string, { in: number; out: number }>();
    let totalIn = 0;
    let totalOut = 0;
    for (const p of payments) {
      const day = p.paymentDate.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { in: 0, out: 0 };
      if (p.direction === 'INCOMING') {
        cur.in = round2(cur.in + Number(p.amount));
        totalIn = round2(totalIn + Number(p.amount));
      } else {
        cur.out = round2(cur.out + Number(p.amount));
        totalOut = round2(totalOut + Number(p.amount));
      }
      byDay.set(day, cur);
    }
    return {
      days: [...byDay.entries()].map(([date, v]) => ({ date, ...v, net: round2(v.in - v.out) })),
      totalIn,
      totalOut,
      net: round2(totalIn - totalOut),
    };
  }

  /** Warranty claims summary. */
  async warrantyReport() {
    const byStatus = await this.prisma.warrantyClaim.groupBy({ by: ['status'], _count: true });
    const byProduct = await this.prisma.warrantyClaim.groupBy({
      by: ['productId'],
      _count: true,
      orderBy: { _count: { productId: 'desc' } },
      take: 10,
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: byProduct.map((b) => b.productId) } },
      select: { id: true, sku: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    return {
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byProduct: byProduct.map((b) => ({ product: productMap.get(b.productId), count: b._count })),
    };
  }

  /** Reorder suggestions based on 90-day sales velocity vs current stock. */
  async reorderSuggestions() {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const items = await this.prisma.invoiceItem.groupBy({
      by: ['productId'],
      where: { invoice: { type: 'SALE', status: { not: 'CANCELLED' }, issueDate: { gte: since } }, productId: { not: null } },
      _sum: { quantity: true },
    });
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true, lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
    });
    const soldMap = new Map(items.map((i) => [i.productId, i._sum.quantity ?? 0]));
    return products
      .map((p) => {
        const stock = p.stockLevels.reduce((s, l) => s + l.quantity, 0);
        const sold90 = soldMap.get(p.id) ?? 0;
        const dailyVelocity = sold90 / 90;
        const daysOfStock = dailyVelocity > 0 ? Math.floor(stock / dailyVelocity) : null;
        const suggestedOrder = dailyVelocity > 0 ? Math.max(0, Math.ceil(dailyVelocity * 30 - stock)) : 0;
        return { sku: p.sku, name: p.name, stock, sold90, daysOfStock, suggestedOrder, isLow: stock <= p.lowStockThreshold };
      })
      .filter((r) => r.isLow || (r.daysOfStock !== null && r.daysOfStock < 30))
      .sort((a, b) => (a.daysOfStock ?? 9999) - (b.daysOfStock ?? 9999));
  }
}
