import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { calcDocTotals, calcLine, round2 } from '../common/calc';

@Injectable()
export class SalesOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private stock: StockService,
    private invoices: InvoicesService,
    private payments: PaymentsService,
  ) {}

  /** Paid / outstanding derived from the order's non-cancelled invoices. */
  private paymentInfo(order: { total: any; invoices?: { status: string; total: any; paidAmount: any }[] }) {
    const active = (order.invoices ?? []).filter((i) => i.status !== 'CANCELLED');
    const paidAmount = round2(active.reduce((s, i) => s + Number(i.paidAmount), 0));
    const total = Number(order.total);
    const outstanding = round2(Math.max(0, total - paidAmount));
    const paymentStatus =
      total > 0 && paidAmount >= total - 0.01 ? 'PAID' : paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
    return { paidAmount, outstanding, paymentStatus };
  }

  findAll(query: { search?: string; status?: string; paymentStatus?: string; clientId?: string; page?: number; pageSize?: number }) {
    const where: Prisma.SalesOrderWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    // paymentStatus is derived from the sum of paidAmount across this order's
    // non-cancelled invoices (see paymentInfo), not a stored column. UNPAID
    // means that sum is zero, i.e. every invoice is either cancelled or has
    // paid nothing — expressible as a relation filter without raw SQL.
    if (query.paymentStatus === 'UNPAID') {
      where.invoices = { every: { OR: [{ status: 'CANCELLED' }, { paidAmount: { lte: 0 } }] } };
    }
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.salesOrder.count({ where });
    return this.prisma.salesOrder
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          client: { select: { name: true, phone: true } },
          items: true,
          invoices: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({
        items: items.map((o) => ({ ...o, ...this.paymentInfo(o) })),
        total: await totalPromise,
        page,
        pageSize,
      }));
  }

  async findOne(id: string) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: { include: { addresses: true } },
        warehouse: true,
        quotation: { select: { id: true, number: true } },
        items: { include: { product: { select: { sku: true, name: true, trackSerials: true } } } },
        invoices: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
        serviceJobs: { select: { id: true, number: true, status: true, type: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    // Non-rejected refunds against this order's invoices, so the UI can show
    // refunded quantities per item and the order's net-after-refunds total.
    const refundWhere = { deletedAt: null, status: { not: 'REJECTED' as const }, invoice: { salesOrderId: id } };
    const [returnedItems, refundsAgg] = await Promise.all([
      this.prisma.returnItem.groupBy({
        by: ['productId'],
        where: { refund: refundWhere },
        _sum: { quantity: true },
      }),
      this.prisma.refund.aggregate({ where: refundWhere, _sum: { totalAmount: true } }),
    ]);
    return {
      ...so,
      ...this.paymentInfo(so),
      refundedByProduct: Object.fromEntries(returnedItems.map((r) => [r.productId, r._sum.quantity ?? 0])),
      refundedTotal: Number(refundsAgg._sum.totalAmount ?? 0),
    };
  }

  /**
   * Builds order lines. The unit price is always the product's current sale
   * price (server-enforced — clients cannot override it); discounts are the
   * only way to reduce what the customer pays.
   */
  private async buildItems(items: any[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, salePrice: true },
    });
    const priceById = new Map(products.map((p) => [p.id, Number(p.salePrice)]));
    return items.map((i) => {
      const unitPrice = priceById.get(i.productId);
      if (unitPrice === undefined) throw new NotFoundException(`Product ${i.productId} not found`);
      const t = calcLine({ ...i, unitPrice });
      return {
        productId: i.productId,
        description: i.description,
        quantity: i.quantity,
        unitPrice,
        discountType: i.discountType ?? null,
        discountValue: i.discountValue ?? 0,
        lineTotal: t.lineTotal,
        _totals: t,
      };
    });
  }

  async create(userId: string, dto: any) {
    // Credit limit warning check
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const built = await this.buildItems(dto.items);
    const totals = calcDocTotals(
      built.map((b) => b._totals),
      dto.discountType,
      dto.discountValue,
      dto.shippingFee ?? 0,
    );
    const number = await this.numbering.next('SALES_ORDER');
    const so = await this.prisma.salesOrder.create({
      data: {
        number,
        clientId: dto.clientId,
        quotationId: dto.quotationId,
        warehouseId: dto.warehouseId,
        status: 'PENDING',
        discountType: dto.discountType ?? null,
        discountValue: dto.discountValue ?? 0,
        shippingFee: dto.shippingFee ?? 0,
        notes: dto.notes,
        ...totals,
        createdById: userId,
        items: { create: built.map(({ _totals, ...item }) => item) },
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'CREATE', 'SalesOrder', so.id, { number });
    return so;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sales order not found');
    if (existing.status !== 'PENDING')
      throw new BadRequestException('Only pending orders can be edited (cancel and recreate otherwise)');

    let itemsData = undefined as any;
    let totals = {} as any;
    if (dto.items) {
      const built = await this.buildItems(dto.items);
      totals = calcDocTotals(
        built.map((b) => b._totals),
        dto.discountType ?? (existing.discountType as any),
        dto.discountValue ?? Number(existing.discountValue),
        dto.shippingFee ?? Number(existing.shippingFee),
      );
      itemsData = { deleteMany: {}, create: built.map(({ _totals, ...item }) => item) };
    }
    const so = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        clientId: dto.clientId,
        warehouseId: dto.warehouseId,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        shippingFee: dto.shippingFee,
        notes: dto.notes,
        ...totals,
        ...(itemsData ? { items: itemsData } : {}),
      },
      include: { items: true },
    });
    await this.audit.log(userId, 'UPDATE', 'SalesOrder', id);
    return so;
  }

  /**
   * Confirm order: deducts stock for each line and optionally marks serial numbers as SOLD.
   * serialAssignments: [{ productId, serialNumbers: string[] }]
   */
  async confirm(userId: string, id: string, serialAssignments?: { productId: string; serialNumbers: string[] }[]) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { items: { include: { product: { select: { isService: true } } } }, client: true },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status !== 'PENDING') throw new BadRequestException(`Order is already ${so.status}`);

    // Credit limit check (warning enforced server-side)
    if (Number(so.client.creditLimit) > 0) {
      const outstanding = await this.prisma.invoice.aggregate({
        where: { clientId: so.clientId, type: 'SALE', status: { notIn: ['CANCELLED', 'PAID'] } },
        _sum: { total: true, paidAmount: true },
      });
      const balance = Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.paidAmount ?? 0);
      if (balance + Number(so.total) > Number(so.client.creditLimit)) {
        throw new BadRequestException(
          `Credit limit exceeded: outstanding ${balance.toFixed(2)} + order ${Number(so.total).toFixed(2)} > limit ${Number(so.client.creditLimit).toFixed(2)}`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of so.items) {
        if (item.product?.isService) continue; // services carry no stock
        await this.stock.adjustStock(tx, {
          productId: item.productId,
          warehouseId: so.warehouseId,
          delta: -item.quantity,
          type: 'OUT',
          userId,
          reason: `Sales order ${so.number} confirmed`,
          refType: 'SalesOrder',
          refId: so.id,
        });
      }
      if (serialAssignments?.length) {
        for (const a of serialAssignments) {
          const units = await tx.productUnit.findMany({
            where: { serialNumber: { in: a.serialNumbers }, productId: a.productId, status: 'IN_STOCK' },
          });
          if (units.length !== a.serialNumbers.length) {
            throw new BadRequestException(`Some serial numbers for product #${a.productId} are not in stock`);
          }
          await tx.productUnit.updateMany({
            where: { id: { in: units.map((u) => u.id) } },
            data: { status: 'SOLD', salesOrderId: so.id },
          });
        }
      }
      await tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED' } });
    });
    await this.audit.log(userId, 'CONFIRM', 'SalesOrder', id, { number: so.number });
    return this.findOne(id);
  }

  async deliver(userId: string, id: string, deliveries: { itemId: string; quantity: number }[]) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join', where: { id }, include: { items: true } });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status !== 'CONFIRMED' && so.status !== 'PARTIALLY_DELIVERED')
      throw new BadRequestException('Order must be confirmed before delivery');

    await this.prisma.$transaction(async (tx) => {
      for (const d of deliveries) {
        const item = so.items.find((i) => i.id === d.itemId);
        if (!item) throw new BadRequestException(`Item ${d.itemId} not on this order`);
        if (item.deliveredQty + d.quantity > item.quantity)
          throw new BadRequestException(`Delivery exceeds ordered quantity for item ${d.itemId}`);
        await tx.salesOrderItem.update({
          where: { id: d.itemId },
          data: { deliveredQty: { increment: d.quantity } },
        });
      }
      const updated = await tx.salesOrderItem.findMany({ where: { salesOrderId: id } });
      const allDelivered = updated.every((i) => i.deliveredQty >= i.quantity);
      await tx.salesOrder.update({
        where: { id },
        data: { status: allDelivered ? 'DELIVERED' : 'PARTIALLY_DELIVERED' },
      });
    });
    await this.audit.log(userId, 'DELIVER', 'SalesOrder', id, { deliveries });
    return this.findOne(id);
  }

  /**
   * Pay a sales order directly. If the order has no invoice yet, a full
   * invoice is generated first; the amount is then applied to the order's
   * unpaid invoices oldest-first.
   */
  async pay(
    userId: string,
    id: string,
    dto: { amount: number; method: string; reference?: string; notes?: string; paymentDate?: string },
  ) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { invoices: { where: { deletedAt: null } } },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Cannot pay a cancelled order');

    const { outstanding } = this.paymentInfo(so);
    if (dto.amount > outstanding + 0.01)
      throw new BadRequestException(`Payment exceeds outstanding balance (${outstanding.toFixed(2)})`);

    let invoices = so.invoices.filter((i) => i.status !== 'CANCELLED');
    if (invoices.length === 0) {
      await this.invoices.fromSalesOrder(userId, id, {});
      invoices = (
        await this.prisma.invoice.findMany({ where: { salesOrderId: id, deletedAt: null, status: { not: 'CANCELLED' } } })
      ) as any;
    }

    // Apply oldest-first across unpaid invoices
    let remaining = round2(dto.amount);
    const unpaid = invoices
      .filter((i) => Number(i.paidAmount) < Number(i.total) - 0.01)
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());
    for (const inv of unpaid) {
      if (remaining <= 0) break;
      const invRemaining = round2(Number(inv.total) - Number(inv.paidAmount));
      const slice = Math.min(remaining, invRemaining);
      await this.payments.create(userId, {
        direction: 'INCOMING',
        invoiceId: inv.id,
        clientId: so.clientId,
        method: dto.method,
        amount: slice,
        paymentDate: dto.paymentDate,
        reference: dto.reference,
        notes: dto.notes ?? `Payment on order ${so.number}`,
      });
      remaining = round2(remaining - slice);
    }
    if (remaining > 0.01)
      throw new BadRequestException(
        `Only ${round2(dto.amount - remaining).toFixed(2)} could be applied — create an invoice for the remaining balance first`,
      );

    await this.audit.log(userId, 'PAY', 'SalesOrder', id, { number: so.number, amount: dto.amount });
    return this.findOne(id);
  }

  /** Returns the order's active invoice id, generating the full invoice when none exists. */
  async ensureInvoice(userId: string, id: string): Promise<string> {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { invoices: { where: { deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Order is cancelled');
    if (so.invoices[0]) return so.invoices[0].id;
    const inv = await this.invoices.fromSalesOrder(userId, id, {});
    return inv.id;
  }

  async cancel(userId: string, id: string) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { items: { include: { product: { select: { isService: true } } } }, invoices: true },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Order already cancelled');
    if (so.status === 'DELIVERED')
      throw new BadRequestException('Delivered orders cannot be cancelled — create a refund instead');
    const activeInvoices = so.invoices.filter((inv) => inv.status !== 'CANCELLED' && !inv.deletedAt);
    if (activeInvoices.some((inv) => Number(inv.paidAmount) > 0))
      throw new BadRequestException('Order has paid invoices — refund the payments first');

    const wasStockDeducted = so.status !== 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      // Unpaid invoices are cancelled along with the order
      for (const inv of activeInvoices) {
        await tx.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED' } });
        await tx.productUnit.updateMany({
          where: { invoiceId: inv.id },
          data: { invoiceId: null, status: 'IN_STOCK', salesOrderId: null, warrantyStartDate: null, warrantyEndDate: null, performanceWarrantyEndDate: null },
        });
      }
      if (wasStockDeducted) {
        for (const item of so.items) {
          if (item.product?.isService) continue;
          await this.stock.adjustStock(tx, {
            productId: item.productId,
            warehouseId: so.warehouseId,
            delta: item.quantity,
            type: 'IN',
            userId,
            reason: `Sales order ${so.number} cancelled — stock restored`,
            refType: 'SalesOrder',
            refId: so.id,
          });
        }
      }
      // Release any serial units assigned to this order but not yet invoiced
      await tx.productUnit.updateMany({
        where: { salesOrderId: so.id, invoiceId: null, status: 'SOLD' },
        data: { status: 'IN_STOCK', salesOrderId: null },
      });
      await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.log(userId, 'CANCEL', 'SalesOrder', id, { number: so.number, stockRestored: wasStockDeducted });
    return this.findOne(id);
  }
}
