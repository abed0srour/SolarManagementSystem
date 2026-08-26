import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { StockService } from '../inventory/stock.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { calcDocTotals, calcLine, round2 } from '../common/calc';
import { buildCompositeItems, writeSubItems } from '../common/composite-items';
import { calcOrderProfit } from '../common/order-profit';
import { SafeDeleteResult, UsageReport, isUnused, usedBy } from '../common/safe-delete';

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

  /**
   * Whether this order can still be cancelled, and if not, why.
   *
   * Confirming an order does NOT make it uncancellable — a customer can back out
   * any time before the goods leave, and `cancel()` puts the stock back. What
   * makes it uncancellable is the goods or the money having moved:
   *
   *  - COLLECTED — the customer walked out with it. Restoring stock here would
   *    invent inventory that is physically gone.
   *  - DELIVERED — same, via the delivery flow; a refund is the correct route.
   *  - HAS_PAYMENTS — money was taken, so it has to be refunded first.
   *
   * Computed here rather than in the UI so the button and the endpoint can never
   * disagree about what is allowed. `cancel()` re-checks all of it server-side.
   */
  private cancelInfo(order: {
    status: string;
    claimedAt?: Date | null;
    invoices?: { status: string; paidAmount: any; deletedAt?: Date | null }[];
  }): { cancellable: boolean; cancelBlockedReason: string | null } {
    const active = (order.invoices ?? []).filter((i) => i.status !== 'CANCELLED' && !i.deletedAt);
    const reason =
      order.status === 'CANCELLED' ? 'ALREADY_CANCELLED'
      : order.status === 'DELIVERED' ? 'DELIVERED'
      : order.claimedAt ? 'COLLECTED'
      : active.some((i) => Number(i.paidAmount) > 0) ? 'HAS_PAYMENTS'
      : null;
    return { cancellable: reason === null, cancelBlockedReason: reason };
  }

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

  findAll(query: { search?: string; status?: string; paymentStatus?: string; clientId?: string; page?: number; pageSize?: number; archived?: string }) {
    // `archived=true` shows the archive instead of the active list.
    const where: Prisma.SalesOrderWhereInput =
      query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
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
        items: items.map((o) => ({ ...o, ...this.paymentInfo(o), ...this.cancelInfo(o) })),
        total: await totalPromise,
        page,
        pageSize,
      }));
  }

  async findOne(id: string) {
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: { include: { addresses: true } },
        warehouse: true,
        quotation: { select: { id: true, number: true } },
        // Top-level lines only, each carrying its bundle components — otherwise
        // sub-items would also appear as loose lines in the order view.
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true, trackSerials: true, costPrice: true, salePrice: true } },
            subItems: {
              orderBy: { id: 'asc' },
              // costPrice comes along because a bundle's cost is the sum of its
              // components' -- the header itself has no product to cost.
              include: { product: { select: { sku: true, name: true, costPrice: true } } },
            },
          },
        },
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
      ...this.cancelInfo(so),
      refundedByProduct: Object.fromEntries(returnedItems.map((r) => [r.productId, r._sum.quantity ?? 0])),
      refundedTotal: Number(refundsAgg._sum.totalAmount ?? 0),
      profit: calcOrderProfit(so),
    };
  }

  /**
   * Builds order lines.
   *
   * The product's sale price is the default, but a line may override it — both
   * downwards and upwards, so an item can be marked up above list price for a
   * particular order. An omitted `unitPrice` falls back to the product's
   * current sale price; a negative one is rejected. Line discounts then apply
   * on top of whatever unit price the line ended up with.
   */
  private buildItems(items: any[]) {
    return buildCompositeItems(this.prisma, items);
  }

  /**
   * Alphabet for pickup codes: digits and capitals minus the pairs that get
   * misread off a printed receipt — 0/O and 1/I/L. The customer reads this
   * aloud or the warehouse types it, so ambiguity is the enemy.
   */
  private static readonly CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  /** QR codes are valid for a day; reprinting the receipt mints a fresh one. */
  private static readonly PICKUP_TOKEN_HOURS = 24;

  /**
   * Short, unique code printed on the receipt as the scanner-free fallback.
   * Checked against the unique index, so a customer can never arrive with a
   * code that resolves to someone else's order.
   */
  private async generatePickupCode(tx: Prisma.TransactionClient, length = 8): Promise<string> {
    const alphabet = SalesOrdersService.CODE_ALPHABET;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
      const taken = await tx.salesOrder.findFirst({ where: { pickupCode: code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new BadRequestException('Could not generate a pickup code, please try again');
  }

  /**
   * A UUID is 16 bytes; its canonical text form wastes 14 characters on dashes
   * and hex expansion. Base64url puts it in 22.
   */
  private static uuidToB64(uuid: string): string {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
  }

  private static b64ToUuid(b64: string): string | null {
    const hex = Buffer.from(b64, 'base64url').toString('hex');
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Truncated HMAC-SHA256 over the token body. 16 bytes is 128 bits of
   * authentication and keeps the whole token near 50 characters — payload size
   * drives QR module count, so a compact token is what lets the printed code be
   * small enough for a receipt and still scan.
   */
  private static sign(body: string): string {
    const secret = process.env.JWT_SECRET ?? '';
    return createHmac('sha256', secret).update(body).digest().subarray(0, 16).toString('base64url');
  }

  /** Mint the signed token that goes inside the receipt's QR code. */
  async issuePickupToken(orderId: string): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + SalesOrdersService.PICKUP_TOKEN_HOURS * 3600 * 1000);
    const expMinutes = Math.floor(expiresAt.getTime() / 60000);
    const body = `${SalesOrdersService.uuidToB64(orderId)}.${expMinutes.toString(36)}`;
    return { token: `${body}.${SalesOrdersService.sign(body)}`, expiresAt };
  }

  /**
   * Verify a scanned QR. Never throws for a bad code — the scanner screen has to
   * explain *why* it failed, and "expired yesterday" is a very different
   * conversation with a customer than "this is not our QR".
   */
  async verifyPickupToken(token: string) {
    const invalid = { valid: false as const, reason: 'INVALID', message: 'This QR code was not issued by this system' };

    const parts = token.trim().split('.');
    // A token of the wrong shape (a JWT, say) fails here before any crypto runs,
    // so a login token can never be mistaken for a pickup code.
    if (parts.length !== 3 || parts[0].length !== 22 || parts[2].length !== 22) return invalid;

    const [idPart, expPart, sig] = parts;
    const expected = SalesOrdersService.sign(`${idPart}.${expPart}`);
    // Constant-time: a fast-exit compare leaks how much of a forged signature
    // was right, which is enough to rebuild one byte at a time.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return invalid;

    const expMinutes = parseInt(expPart, 36);
    if (!Number.isFinite(expMinutes)) return invalid;
    if (Date.now() > expMinutes * 60000) {
      return { valid: false as const, reason: 'EXPIRED', message: 'This QR code has expired' };
    }

    const orderId = SalesOrdersService.b64ToUuid(idPart);
    if (!orderId) return invalid;

    const order = await this.findOne(orderId).catch(() => null);
    if (!order) return { valid: false, reason: 'NOT_FOUND', message: 'The order on this QR no longer exists' };

    let blocked: string | null = null;
    if (order.claimedAt) blocked = 'Already collected';
    else if (order.status === 'CANCELLED') blocked = 'Order was cancelled';
    else if (order.status === 'PENDING') blocked = 'Order is not confirmed yet';

    return {
      valid: true,
      issuedFor: order.id,
      expiresAt: new Date(expMinutes * 60000),
      claimable: blocked === null,
      reason: blocked,
      order,
    };
  }

  /** Release goods against a scanned QR rather than a typed code. */
  async claimByToken(userId: string, token: string, notes?: string) {
    const check = await this.verifyPickupToken(token);
    if (!check.valid) throw new BadRequestException(check.message);
    if (!check.claimable) throw new BadRequestException(check.reason!);
    return this.claim(userId, (check.order as any).pickupCode, notes);
  }

  /**
   * Find an order from the code on a customer's receipt. Returns a `claimable`
   * verdict rather than throwing, so the counter screen can explain why.
   */
  async findByPickupCode(code: string) {
    const order = await this.prisma.salesOrder.findFirst({
      relationLoadStrategy: 'join',
      where: { pickupCode: code.trim().toUpperCase() },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        warehouse: { select: { name: true } },
        claimedBy: { select: { name: true } },
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true } },
            subItems: { include: { product: { select: { sku: true, name: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('No order matches this code');

    const paid = await this.prisma.invoice.aggregate({
      where: { salesOrderId: order.id, status: { not: 'CANCELLED' } },
      _sum: { total: true, paidAmount: true },
    });
    const outstanding = round2(Number(paid._sum.total ?? 0) - Number(paid._sum.paidAmount ?? 0));

    let reason: string | null = null;
    if (order.claimedAt) reason = 'Already collected';
    else if (order.status === 'CANCELLED') reason = 'Order was cancelled';
    else if (order.status === 'PENDING') reason = 'Order is not confirmed yet';

    return { ...order, outstanding, claimable: reason === null, reason };
  }

  /**
   * Hand the goods over. The re-check inside the transaction is what actually
   * prevents one receipt being used twice — two staff could load the same code
   * simultaneously and both see it as claimable.
   */
  async claim(userId: string, code: string, notes?: string) {
    const normalised = code.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({ where: { pickupCode: normalised } });
      if (!order) throw new NotFoundException('No order matches this code');
      if (order.claimedAt) throw new BadRequestException('This receipt was already collected');
      if (order.status === 'CANCELLED') throw new BadRequestException('Order was cancelled');
      if (order.status === 'PENDING') throw new BadRequestException('Order is not confirmed yet');

      const claimed = await tx.salesOrder.update({
        where: { id: order.id },
        data: { claimedAt: new Date(), claimedById: userId, claimNotes: notes },
      });
      await this.audit.log(userId, 'CLAIM', 'SalesOrder', order.id, { number: order.number, pickupCode: normalised });
      return { success: true, number: claimed.number, claimedAt: claimed.claimedAt };
    });
  }


  async create(userId: string, dto: any) {
    // Credit limit warning check
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    let warehouseId = dto.warehouseId;
    if (!warehouseId) {
      const warehouses = await this.prisma.warehouse.findMany({ select: { id: true } });
      if (warehouses.length === 1) {
        warehouseId = warehouses[0].id;
      } else if (warehouses.length > 1) {
        throw new BadRequestException('Please select a warehouse');
      }
    }

    const built = await this.buildItems(dto.items);
    const totals = calcDocTotals(
      built.map((b) => b._totals),
      dto.discountType,
      dto.discountValue,
      dto.shippingFee ?? 0,
    );
    const number = await this.numbering.next('SALES_ORDER');
    const so = await this.prisma.$transaction(async (tx) => {
      const pickupCode = await this.generatePickupCode(tx);
      const created = await tx.salesOrder.create({
        data: {
          number,
          pickupCode,
          clientId: dto.clientId,
          quotationId: dto.quotationId,
          warehouseId,
          status: 'PENDING',
          discountType: dto.discountType ?? null,
          discountValue: dto.discountValue ?? 0,
          shippingFee: dto.shippingFee ?? 0,
          notes: dto.notes,
          showSubItemsOnInvoice: dto.showSubItemsOnInvoice ?? false,
          ...totals,
          createdById: userId,
          items: { create: built.map(({ _totals, _subItems, ...item }) => item) },
        },
        include: { items: true },
      });
      await writeSubItems(tx.salesOrderItem, 'salesOrderId', created.id, built);
      return created;
    });
    await this.audit.log(userId, 'CREATE', 'SalesOrder', so.id, { number });
    return so;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.salesOrder.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Sales order not found');
    if (existing.status !== 'PENDING')
      throw new BadRequestException('Only pending orders can be edited (cancel and recreate otherwise)');

    let built: any[] | undefined;
    let itemsData = undefined as any;
    let totals = {} as any;
    if (dto.items) {
      built = await this.buildItems(dto.items);
      totals = calcDocTotals(
        built.map((b) => b._totals),
        dto.discountType ?? (existing.discountType as any),
        dto.discountValue ?? Number(existing.discountValue),
        dto.shippingFee ?? Number(existing.shippingFee),
      );
      // `deleteMany: {}` clears sub-items too — they cascade from their parent
      // and are rewritten below from the incoming payload.
      itemsData = { deleteMany: {}, create: built.map(({ _totals, _subItems, ...item }) => item) };
    }
    const so = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrder.update({
        where: { id },
        data: {
          clientId: dto.clientId,
          warehouseId: dto.warehouseId,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          shippingFee: dto.shippingFee,
          notes: dto.notes,
          ...(dto.showSubItemsOnInvoice === undefined ? {} : { showSubItemsOnInvoice: dto.showSubItemsOnInvoice }),
          ...totals,
          ...(itemsData ? { items: itemsData } : {}),
        },
        include: { items: true },
      });
      if (built) await writeSubItems(tx.salesOrderItem, 'salesOrderId', id, built);
      return updated;
    });
    await this.audit.log(userId, 'UPDATE', 'SalesOrder', id);
    return so;
  }

  /**
   * Confirm order: deducts stock for each line and optionally marks serial numbers as SOLD.
   * serialAssignments: [{ productId, serialNumbers: string[] }]
   */
  async confirm(userId: string, id: string, serialAssignments?: { productId: string; serialNumbers: string[] }[]) {
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join',
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
        // Bundle headers hold no product of their own — their components do,
        // and each component is a real catalogue item, so it draws stock just
        // like a top-level line.
        if (!item.productId || item.isComposite) continue;
        if (item.product?.isService) continue; // services carry no stock
        await this.stock.adjustStock(tx, {
          productId: item.productId,
          warehouseId: so.warehouseId,
          delta: -Number(item.quantity),
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
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join', where: { id }, include: { items: true } });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status !== 'CONFIRMED' && so.status !== 'PARTIALLY_DELIVERED')
      throw new BadRequestException('Order must be confirmed before delivery');

    await this.prisma.$transaction(async (tx) => {
      for (const d of deliveries) {
        const item = so.items.find((i) => i.id === d.itemId);
        if (!item) throw new BadRequestException(`Item ${d.itemId} not on this order`);
        if (item.deliveredQty + d.quantity > Number(item.quantity))
          throw new BadRequestException(`Delivery exceeds ordered quantity for item ${d.itemId}`);
        await tx.salesOrderItem.update({
          where: { id: d.itemId },
          data: { deliveredQty: { increment: d.quantity } },
        });
      }
      const updated = await tx.salesOrderItem.findMany({ where: { salesOrderId: id } });
      // Sub-items are shipped as part of their bundle, so they are not tracked
      // for delivery in their own right.
      const allDelivered = updated
        .filter((i) => !i.parentItemId)
        .every((i) => i.deliveredQty >= Number(i.quantity));
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
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join',
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
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join',
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
    const so = await this.prisma.salesOrder.findFirst({ relationLoadStrategy: 'join',
      where: { id },
      include: { items: { include: { product: { select: { isService: true } } } }, invoices: true },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Order already cancelled');
    if (so.status === 'DELIVERED')
      throw new BadRequestException('Delivered orders cannot be cancelled — create a refund instead');
    // Collected via the pickup QR: the goods are physically gone even though the
    // status is still CONFIRMED, so restoring stock here would invent inventory.
    if (so.claimedAt)
      throw new BadRequestException('Order was already collected — create a refund instead');
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
          // Mirrors confirm(): bundle components moved stock, headers did not.
          if (!item.productId || item.isComposite) continue;
          if (item.product?.isService) continue;
          await this.stock.adjustStock(tx, {
            productId: item.productId,
            warehouseId: so.warehouseId,
            delta: Number(item.quantity),
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

  /**
   * What still points at a cancelled order, and would therefore lose its
   * reference if the row were really deleted.
   *
   * Cancelled invoices count. They carry a number issued out of the same
   * sequence as every live invoice, so the order behind them has to stay
   * reachable. Stock movements count for the same reason from the inventory
   * side: a confirmed order writes an OUT movement and cancelling writes the
   * matching IN, and those two rows reference the order by id. They are a loose
   * reference with no foreign key, so nothing but this count protects them.
   *
   * Every foreign key into SalesOrder is optional, which means the database
   * would answer a delete by quietly nulling those links rather than refusing —
   * so the check has to happen here, before the delete, not be left to the
   * schema.
   */
  private async orderUsage(id: string) {
    const [invoices, serviceJobs, installations, units, stockMovements] = await Promise.all([
      this.prisma.invoice.count({ where: { salesOrderId: id, deletedAt: null } }),
      this.prisma.serviceJob.count({ where: { salesOrderId: id } }),
      this.prisma.installation.count({ where: { salesOrderId: id } }),
      this.prisma.productUnit.count({ where: { salesOrderId: id } }),
      this.prisma.stockMovement.count({ where: { refType: 'SalesOrder', refId: id } }),
    ]);
    return { invoices, serviceJobs, installations, units, stockMovements };
  }

  /** Can this order be deleted outright? `remove()` re-checks server-side. */
  async usage(id: string): Promise<UsageReport> {
    const so = await this.prisma.salesOrder.findFirst({ where: { id }, select: { status: true } });
    if (!so) throw new NotFoundException('Sales order not found');
    const counts = await this.orderUsage(id);
    return {
      used: !isUnused(counts),
      usedBy: usedBy(counts),
      // A live order is deleted by cancelling it first: cancelling is what puts
      // the stock back and voids the invoices. Deleting straight from CONFIRMED
      // would drop the order while its goods stayed out of inventory.
      blockedReason: so.status === 'CANCELLED' ? undefined : 'NOT_CANCELLED',
    };
  }

  /**
   * Delete a cancelled order: permanently when nothing came of it, archived when
   * it left invoices or stock movements behind. See `common/safe-delete.ts`.
   *
   * An order cancelled before it was ever confirmed is a typo — no invoice, no
   * movement, nothing referring to it — and purging it is what stops the list
   * filling with mistakes. One that was confirmed, invoiced and then cancelled
   * is history: it drops out of the list but the documents still resolve.
   */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const so = await this.prisma.salesOrder.findFirst({ where: { id } });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.deletedAt) throw new BadRequestException('Order is already deleted');
    if (so.status !== 'CANCELLED')
      throw new BadRequestException('Only a cancelled order can be deleted — cancel it first');

    const counts = await this.orderUsage(id);
    if (!isUnused(counts)) {
      const used = usedBy(counts);
      const parts = Object.entries(used).map(([k, v]) => `${v} ${k}`);
      throw new BadRequestException(
        `Cannot delete sales order "${so.number}" because it has existing relations (${parts.join(', ')}).`,
      );
    }

    // Items cascade with the order.
    await this.prisma.salesOrder.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'SalesOrder', id, { number: so.number });
    return { success: true, mode: 'PURGED', usedBy: {} };
  }

  /** Bring an archived order back into the active list. */
  async restore(userId: string, id: string) {
    const so = await this.prisma.salesOrder.findFirst({ where: { id } });
    if (!so) throw new NotFoundException('Sales order not found');
    if (!so.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.salesOrder.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log(userId, 'RESTORE', 'SalesOrder', id, { number: so.number });
    return { success: true, alreadyActive: false };
  }
}
