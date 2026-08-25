import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/calc';
import { expandRevenueLines } from '../common/revenue';

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

    // One parallel burst — every sequential query here costs a full round-trip
    // to the remote database.
    const completedRefunds = { deletedAt: null, status: 'COMPLETED' as const, createdAt: period };
    const [
      salesAgg,
      receivables,
      payables,
      invoiceCount,
      openClaims,
      pendingOrders,
      expensesAgg,
      activeInstallations,
      energyAgg,
      invoices,
      saleItems,
      products,
      clientGroups,
      refundsAgg,
      returnedItems,
      newClientsCount,
      recentInvoices,
    ] = await Promise.all([
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
      this.prisma.expense.aggregate({ where: { deletedAt: null, expenseDate: period }, _sum: { amount: true } }),
      this.prisma.installation.count({ where: { deletedAt: null, status: { in: ['COMMISSIONED', 'ACTIVE'] } } }),
      this.prisma.energyReading.aggregate({ where: { readingDate: period }, _sum: { energyKwh: true } }),
      this.prisma.invoice.findMany({
        where: saleWhere,
        select: { issueDate: true, total: true, paidAmount: true },
        orderBy: { issueDate: 'asc' },
      }),
      // Top-level lines only, with each bundle's components attached — see
      // expandRevenueLines for why components are not queried directly.
      this.prisma.invoiceItem.findMany({ relationLoadStrategy: 'join',
        where: { invoice: saleWhere, parentItemId: null },
        include: {
          product: { include: { subCategory: { include: { category: true } } } },
          subItems: {
            select: {
              quantity: true,
              lineTotal: true,
              product: { include: { subCategory: { include: { category: true } } } },
            },
          },
        },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: { lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
      }),
      this.prisma.invoice.groupBy({
        by: ['clientId'],
        where: { ...saleWhere, clientId: { not: null } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({ where: completedRefunds, _sum: { totalAmount: true } }),
      this.prisma.returnItem.findMany({ relationLoadStrategy: 'join',
        where: { condition: 'RESELLABLE', refund: completedRefunds },
        include: { product: { select: { costPrice: true } } },
      }),
      this.prisma.client.count({ where: { deletedAt: null, createdAt: period } }),
      this.prisma.invoice.findMany({
        where: { type: 'SALE', deletedAt: null, issueDate: period },
        include: {
          client: { select: { id: true, name: true, phone: true } },
          items: { select: { product: { select: { name: true } }, quantity: true, lineTotal: true }, take: 2 },
        },
        orderBy: { issueDate: 'desc' },
        take: 50,
      }),
    ]);

    // Sales by day (for chart)
    const byDay = new Map<string, { total: number; collected: number; count: number }>();
    for (const inv of invoices) {
      const day = inv.issueDate.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { total: 0, collected: 0, count: 0 };
      cur.total = round2(cur.total + Number(inv.total));
      cur.collected = round2(cur.collected + Number(inv.paidAmount ?? 0));
      cur.count += 1;
      byDay.set(day, cur);
    }

    // Sales by category
    const byCategory = new Map<string, number>();
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    let cogs = 0;
    // A bundle's charged price is split across its components, so category and
    // product revenue add back up to the invoice totals the KPIs report.
    for (const line of expandRevenueLines(saleItems)) {
      const cat = line.product.subCategory.category.name;
      byCategory.set(cat, round2((byCategory.get(cat) ?? 0) + line.revenue));
      const key = line.product.sku;
      const cur = byProduct.get(key) ?? { name: line.product.name, qty: 0, revenue: 0 };
      cur.qty += line.quantity;
      cur.revenue = round2(cur.revenue + line.revenue);
      byProduct.set(key, cur);
      cogs += Number(line.product.costPrice) * line.quantity;
    }
    // Lines with no product at all (ad-hoc text, deposit invoices) carry revenue
    // that belongs to no SKU. It is in the headline revenue but has no category.
    const unattributed = round2(
      saleItems
        .filter((i) => !i.product && !i.isComposite)
        .reduce((s, i) => s + Number(i.lineTotal), 0),
    );
    if (unattributed !== 0) byCategory.set('Other', round2((byCategory.get('Other') ?? 0) + unattributed));
    const revenue = Number(salesAgg._sum.total ?? 0);

    // Completed refunds reduce revenue; resellable returns went back into
    // stock, so their cost also leaves COGS (damaged returns stay a sunk cost).
    const refunds = Number(refundsAgg._sum.totalAmount ?? 0);
    const returnedCogs = returnedItems.reduce((s, ri) => s + Number(ri.product.costPrice) * ri.quantity, 0);
    const netRevenue = round2(revenue - refunds);
    const grossProfit = round2(netRevenue - (cogs - returnedCogs));

    // Low stock count
    const lowStockCount = products.filter(
      (p) => p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0) <= p.lowStockThreshold,
    ).length;

    // Top clients by billed revenue in the period (all clients with sales, sorted)
    const clientRows = await this.prisma.client.findMany({
      where: { id: { in: clientGroups.map((g) => g.clientId!).filter(Boolean) } },
      select: { id: true, name: true, phone: true },
    });
    const clientMap = new Map(clientRows.map((c) => [c.id, c]));
    const topClients = clientGroups
      .map((g) => {
        const client = clientMap.get(g.clientId!);
        return {
          clientId: g.clientId,
          name: client?.name ?? '—',
          phone: client?.phone ?? '',
          invoices: g._count._all,
          revenue: round2(Number(g._sum.total ?? 0)),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const topProducts = [...byProduct.entries()]
      .map(([sku, v]) => ({ sku, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    const recentTransactions = recentInvoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      clientName: inv.client?.name ?? 'Walk-in Customer',
      date: inv.issueDate,
      status: inv.status,
      total: Number(inv.total),
      paidAmount: Number(inv.paidAmount),
      itemsSummary: inv.items.map((i) => `${i.product?.name ?? 'Item'} (x${i.quantity})`).join(', ') || 'General Sale',
    }));

    /*
     * The immediately preceding window of the same length, so "vs previous" is
     * always like-for-like: last 7 days against the 7 before, a month against
     * the month before. Comparing to a fixed calendar period instead would make
     * a 10-day range look catastrophic against a full month.
     */
    const span = period.lte.getTime() - period.gte.getTime();
    const prior = { gte: new Date(period.gte.getTime() - span - 1), lte: new Date(period.gte.getTime() - 1) };
    const priorSaleWhere = { type: 'SALE' as const, status: { not: 'CANCELLED' as const }, issueDate: prior };

    const [priorAgg, priorInvoiceCount, priorExpenses, priorItems, orderStatusGroups, priorNewClientsCount] = await Promise.all([
      this.prisma.invoice.aggregate({ where: priorSaleWhere, _sum: { total: true, paidAmount: true } }),
      this.prisma.invoice.count({ where: priorSaleWhere }),
      this.prisma.expense.aggregate({ where: { deletedAt: null, expenseDate: prior }, _sum: { amount: true } }),
      this.prisma.invoiceItem.findMany({
        relationLoadStrategy: 'join',
        where: { invoice: priorSaleWhere, parentItemId: null },
        include: {
          product: { select: { costPrice: true } },
          subItems: { select: { quantity: true, lineTotal: true, product: { select: { costPrice: true } } } },
        },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where: { deletedAt: null, orderDate: period },
        _count: { _all: true },
      }),
      this.prisma.client.count({ where: { deletedAt: null, createdAt: prior } }),
    ]);

    const priorCogs = expandRevenueLines(priorItems).reduce(
      (s, l) => s + Number(l.product.costPrice) * l.quantity,
      0,
    );
    const priorRevenue = Number(priorAgg._sum.total ?? 0);
    const priorExpenseTotal = Number(priorExpenses._sum.amount ?? 0);
    const priorGross = round2(priorRevenue - priorCogs);

    /** Percentage change, or null when there is no baseline to compare against. */
    const delta = (now: number, before: number): number | null =>
      before === 0 ? null : round2(((now - before) / Math.abs(before)) * 100);

    const netProfitNow = round2(grossProfit - Number(expensesAgg._sum.amount ?? 0));

    return {
      topClients,
      topProducts,
      recentTransactions,
      previous: {
        revenue: priorRevenue,
        collected: Number(priorAgg._sum.paidAmount ?? 0),
        grossProfit: priorGross,
        expenses: priorExpenseTotal,
        invoiceCount: priorInvoiceCount,
        netProfit: round2(priorGross - priorExpenseTotal),
        newClients: priorNewClientsCount,
      },
      deltas: {
        revenue: delta(revenue, priorRevenue),
        collected: delta(Number(salesAgg._sum.paidAmount ?? 0), Number(priorAgg._sum.paidAmount ?? 0)),
        grossProfit: delta(grossProfit, priorGross),
        expenses: delta(Number(expensesAgg._sum.amount ?? 0), priorExpenseTotal),
        invoiceCount: delta(invoiceCount, priorInvoiceCount),
        netProfit: delta(netProfitNow, round2(priorGross - priorExpenseTotal)),
        newClients: delta(newClientsCount, priorNewClientsCount),
      },
      /** Doughnut: where orders currently sit in the fulfilment pipeline. */
      orderStatus: orderStatusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      /** Doughnut: how much of what was billed has actually been collected. */
      collectionMix: [
        { key: 'collected', value: Number(salesAgg._sum.paidAmount ?? 0) },
        { key: 'outstanding', value: round2(Math.max(0, revenue - Number(salesAgg._sum.paidAmount ?? 0))) },
      ],
      kpis: {
        revenue,
        refunds,
        netRevenue,
        collected: Number(salesAgg._sum.paidAmount ?? 0),
        grossProfit,
        invoiceCount,
        accountsReceivable: round2(Number(receivables._sum.total ?? 0) - Number(receivables._sum.paidAmount ?? 0)),
        accountsPayable: round2(Number(payables._sum.total ?? 0) - Number(payables._sum.paidAmount ?? 0)),
        openClaims,
        pendingOrders,
        lowStockCount,
        expenses: Number(expensesAgg._sum.amount ?? 0),
        netProfit: round2(grossProfit - Number(expensesAgg._sum.amount ?? 0)),
        activeInstallations,
        energyKwh: Number(energyAgg._sum.energyKwh ?? 0),
        newClientsCount,
      },
      salesByDay: [...byDay.entries()].map(([date, v]) => ({ date, total: v.total, collected: v.collected, count: v.count })),
      salesByCategory: [...byCategory.entries()].map(([category, total]) => ({ category, total })),
    };
  }

  /** Sales and profit per product over a period. */
  async profitByProduct(from?: string, to?: string) {
    const period = this.range(from, to);
    const completedRefunds = { deletedAt: null, status: 'COMPLETED' as const, createdAt: period };
    const [soldLines, returns] = await Promise.all([
      this.prisma.invoiceItem.findMany({
        relationLoadStrategy: 'join',
        where: { invoice: { type: 'SALE', status: { not: 'CANCELLED' }, issueDate: period }, parentItemId: null },
        include: {
          product: { select: { sku: true, name: true, costPrice: true } },
          subItems: {
            select: {
              quantity: true,
              lineTotal: true,
              product: { select: { sku: true, name: true, costPrice: true } },
            },
          },
        },
      }),
      this.prisma.returnItem.findMany({
        relationLoadStrategy: 'join',
        where: { refund: completedRefunds },
        include: { product: { select: { sku: true, name: true, costPrice: true } } },
      }),
    ]);

    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const line of expandRevenueLines(soldLines)) {
      const cur = map.get(line.product.sku) ?? { name: line.product.name, qty: 0, revenue: 0, cost: 0 };
      cur.qty += line.quantity;
      cur.revenue = round2(cur.revenue + line.revenue);
      cur.cost = round2(cur.cost + Number(line.product.costPrice) * line.quantity);
      map.set(line.product.sku, cur);
    }
    for (const ri of returns) {
      const cur = map.get(ri.product.sku) ?? { name: ri.product.name, qty: 0, revenue: 0, cost: 0 };
      cur.qty -= ri.quantity;
      cur.revenue = round2(cur.revenue - Number(ri.unitPrice) * ri.quantity);
      if (ri.condition === 'RESELLABLE') cur.cost = round2(cur.cost - Number(ri.product.costPrice) * ri.quantity);
      map.set(ri.product.sku, cur);
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
      const qty = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
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
    const invoices = await this.prisma.invoice.findMany({ relationLoadStrategy: 'join',
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
    const invoices = await this.prisma.invoice.findMany({ relationLoadStrategy: 'join',
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
    const [payments, cashRefunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: { paymentDate: period },
        select: { direction: true, amount: true, paymentDate: true, method: true },
        orderBy: { paymentDate: 'asc' },
      }),
      // Completed cash refunds are money physically leaving the till
      this.prisma.refund.findMany({
        where: { deletedAt: null, status: 'COMPLETED', method: 'CASH', createdAt: period },
        select: { totalAmount: true, createdAt: true },
      }),
    ]);
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
    for (const r of cashRefunds) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { in: 0, out: 0 };
      cur.out = round2(cur.out + Number(r.totalAmount));
      totalOut = round2(totalOut + Number(r.totalAmount));
      byDay.set(day, cur);
    }
    return {
      days: [...byDay.entries()]
        .map(([date, v]) => ({ date, ...v, net: round2(v.in - v.out) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
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
    // Not a groupBy: a bundle's components are stored at their per-bundle
    // quantity, so selling the same bundle five times has to multiply through
    // or velocity — and therefore the reorder point — comes out five times low.
    const soldLines = await this.prisma.invoiceItem.findMany({
      relationLoadStrategy: 'join',
      where: { invoice: { type: 'SALE', status: { not: 'CANCELLED' }, issueDate: { gte: since } }, parentItemId: null },
      include: {
        product: { select: { id: true } },
        subItems: { select: { quantity: true, lineTotal: true, product: { select: { id: true } } } },
      },
    });
    const items = [...
      expandRevenueLines(soldLines)
        .reduce((m, l) => m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity), new Map<string, number>())
        .entries()
    ].map(([productId, qty]) => ({ productId, _sum: { quantity: qty } }));
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true, lowStockThreshold: true, stockLevels: { select: { quantity: true } } },
    });
    const soldMap = new Map(items.map((i) => [i.productId, Number(i._sum.quantity ?? 0)]));
    return products
      .map((p) => {
        const stock = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
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
