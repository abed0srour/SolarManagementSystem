import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { calcDocTotals, calcLine, round2 } from '../common/calc';
import { buildCompositeItems, writeSubItems } from '../common/composite-items';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: {
    search?: string;
    status?: string;
    type?: string;
    clientId?: string;
    supplierId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.InvoiceWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.type) where.type = query.type as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.invoice.count({ where });
    return this.prisma.invoice
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          client: { select: { name: true } },
          supplier: { select: { name: true } },
          salesOrder: { select: { number: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const inv = await this.prisma.invoice.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: { include: { addresses: true } },
        supplier: true,
        salesOrder: { select: { id: true, number: true } },
        purchaseOrder: { select: { id: true, number: true } },
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true } },
            subItems: { include: { product: { select: { sku: true, name: true } } } },
          },
        },
        payments: { orderBy: { paymentDate: 'desc' }, include: { createdBy: { select: { name: true } } } },
        schedules: { orderBy: { installmentNo: 'asc' } },
        units: { select: { id: true, serialNumber: true, productId: true, warrantyEndDate: true } },
        refunds: { select: { id: true, number: true, status: true, totalAmount: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  /**
   * Create an invoice. For SALE invoices items carry a price snapshot; optional serialNumbers
   * per item link units and start their warranty clock.
   */
  async create(userId: string, dto: any) {
    const isSale = (dto.type ?? 'SALE') === 'SALE';
    if (isSale && !dto.clientId) throw new BadRequestException('Sale invoices require a client');
    if (!isSale && !dto.supplierId) throw new BadRequestException('Purchase invoices require a supplier');

    // A purchase invoice prices its lines at cost, a sale invoice at sale price.
    const lines = await buildCompositeItems(this.prisma, dto.items, isSale ? 'salePrice' : 'costPrice');
    const built = lines.map((line, idx) => ({
      ...line,
      // InvoiceItem has no autoPrice column — the bundle price is already resolved.
      autoPrice: undefined,
      description: line.description ?? '',
      _serialNumbers: dto.items[idx].serialNumbers as string[] | undefined,
      _sourceItemId: dto.items[idx]._sourceItemId as string | undefined,
    }));
    const totals = calcDocTotals(
      built.map((b: any) => b._totals),
      dto.discountType,
      dto.discountValue,
      dto.shippingFee ?? 0,
    );

    const number = await this.numbering.next('INVOICE');
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();

    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          number,
          type: dto.type ?? 'SALE',
          clientId: dto.clientId,
          supplierId: dto.supplierId,
          salesOrderId: dto.salesOrderId,
          purchaseOrderId: dto.purchaseOrderId,
          issueDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          currency: dto.currency ?? 'USD',
          exchangeRate: dto.exchangeRate ?? 1,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountValue ?? 0,
          shippingFee: dto.shippingFee ?? 0,
          notes: dto.notes,
          showSubItemsOnInvoice: dto.showSubItemsOnInvoice ?? false,
          ...totals,
          createdById: userId,
          items: {
            create: built.map(
              ({ _totals, _subItems, _serialNumbers, _sourceItemId, autoPrice, ...item }: any) => item,
            ),
          },
        },
      });

      await writeSubItems(tx.invoiceItem, 'invoiceId', inv.id, built as any);

      // Link serial-numbered units and start warranty
      for (const b of built) {
        if (!b._serialNumbers?.length || !b.productId) continue;
        const product = await tx.product.findUnique({ where: { id: b.productId } });
        const units = await tx.productUnit.findMany({
          where: { serialNumber: { in: b._serialNumbers }, productId: b.productId },
        });
        if (units.length !== b._serialNumbers.length)
          throw new BadRequestException(`Unknown serial numbers for product #${b.productId}`);
        const warrantyEnd = product?.warrantyMonths
          ? new Date(new Date(issueDate).setMonth(issueDate.getMonth() + product.warrantyMonths))
          : null;
        const perfEnd = product?.performanceWarrantyMonths
          ? new Date(new Date(issueDate).setMonth(issueDate.getMonth() + product.performanceWarrantyMonths))
          : null;
        await tx.productUnit.updateMany({
          where: { id: { in: units.map((u) => u.id) } },
          data: {
            invoiceId: inv.id,
            status: 'SOLD',
            warrantyStartDate: issueDate,
            warrantyEndDate: warrantyEnd,
            performanceWarrantyEndDate: perfEnd,
          },
        });
      }
      return inv;
    });

    await this.audit.log(userId, 'CREATE', 'Invoice', invoice.id, { number, total: totals.total });
    return this.findOne(invoice.id);
  }

  /**
   * Copy a sales order's bundle sub-items onto the freshly created invoice.
   *
   * They are attached after the fact rather than inside `create`, because they
   * must hang off the invoice line that was generated for their parent, whose
   * id only exists once the invoice is written. They carry a zero line total:
   * the money is already in the bundle header, and counting it again would
   * double the invoice.
   */
  private async copyBundleSubItems(orderItems: any[], invoiceId: string) {
    const parents = orderItems.filter((i) => i.isComposite && !i.parentItemId);
    if (!parents.length) return;

    const invoiceLines = await this.prisma.invoiceItem.findMany({
      where: { invoiceId, isComposite: true },
      select: { id: true, description: true },
    });

    for (const parent of parents) {
      const children = orderItems.filter((c) => c.parentItemId === parent.id);
      if (!children.length) continue;
      const parentLabel = parent.description ?? parent.product?.name ?? 'Item';
      const invoiceParent = invoiceLines.find((l) => l.description === parentLabel);
      if (!invoiceParent) continue;

      await this.prisma.invoiceItem.createMany({
        data: children.map((c) => ({
          invoiceId,
          parentItemId: invoiceParent.id,
          productId: c.productId ?? null,
          description: c.description ?? c.product?.name ?? 'Component',
          quantity: c.quantity,
          unit: c.unit ?? null,
          unitPrice: c.unitPrice,
          lineTotal: 0,
        })),
      });
    }
  }

  /** Generate a sale invoice directly from a sales order (full or percentage deposit). */
  async fromSalesOrder(userId: string, salesOrderId: string, opts: { percent?: number; dueDate?: string }) {
    const so = await this.prisma.salesOrder.findUnique({ relationLoadStrategy: 'join',
      where: { id: salesOrderId },
      include: { items: { include: { product: true } } },
    });
    if (!so) throw new NotFoundException('Sales order not found');
    if (so.status === 'CANCELLED') throw new BadRequestException('Cannot invoice a cancelled order');

    const percent = opts.percent && opts.percent > 0 && opts.percent < 100 ? opts.percent : undefined;

    if (percent) {
      // Deposit invoice: a single line for X% of the order total
      return this.create(userId, {
        type: 'SALE',
        clientId: so.clientId,
        salesOrderId: so.id,
        dueDate: opts.dueDate,
        items: [
          {
            description: `Deposit (${percent}%) on order ${so.number}`,
            quantity: 1,
            unitPrice: round2((Number(so.total) * percent) / 100),
          },
        ],
        notes: `Deposit invoice for sales order ${so.number}`,
      });
    }

    // Full invoice mirroring order lines (price snapshot from the order)
    const alreadyInvoiced = await this.prisma.invoice.aggregate({
      where: { salesOrderId: so.id, status: { not: 'CANCELLED' } },
      _sum: { total: true },
    });
    const invoicedSoFar = Number(alreadyInvoiced._sum.total ?? 0);

    const inv = await this.create(userId, {
      type: 'SALE',
      clientId: so.clientId,
      salesOrderId: so.id,
      dueDate: opts.dueDate,
      discountType: so.discountType,
      discountValue: Number(so.discountValue),
      shippingFee: Number(so.shippingFee),
      showSubItemsOnInvoice: so.showSubItemsOnInvoice,
      // Only top-level lines become invoice lines. A bundle's sub-items are
      // carried across as children of their parent (see linkSubItems below), so
      // the invoice total counts the bundle once rather than twice.
      items: so.items
        .filter((i) => !i.parentItemId)
        .map((i) => ({
          productId: i.productId ?? undefined,
          description: i.description ?? i.product?.name ?? 'Item',
          quantity: Number(i.quantity),
          unit: i.unit ?? undefined,
          unitPrice: Number(i.unitPrice),
          discountType: i.discountType ?? undefined,
          discountValue: Number(i.discountValue),
          isComposite: i.isComposite,
          // The order's price is the agreed price. Components are copied
          // afterwards by copyBundleSubItems, so re-deriving the bundle price
          // here would read an empty component list and bill zero.
          autoPrice: false,
          _sourceItemId: i.id,
        })),
      notes: invoicedSoFar > 0 ? `Final invoice for order ${so.number} (previously invoiced: ${invoicedSoFar})` : undefined,
    });

    await this.copyBundleSubItems(so.items, inv.id);

    // Link serial units assigned at order confirmation and start their warranty clock
    const orderUnits = await this.prisma.productUnit.findMany({ relationLoadStrategy: 'join',
      where: { salesOrderId: so.id, invoiceId: null },
      include: { product: { select: { warrantyMonths: true, performanceWarrantyMonths: true } } },
    });
    if (orderUnits.length) {
      const issueDate = new Date(inv.issueDate);
      for (const unit of orderUnits) {
        const addMonths = (m: number | null) => {
          if (!m) return null;
          const d = new Date(issueDate);
          d.setMonth(d.getMonth() + m);
          return d;
        };
        await this.prisma.productUnit.update({
          where: { id: unit.id },
          data: {
            invoiceId: inv.id,
            warrantyStartDate: issueDate,
            warrantyEndDate: addMonths(unit.product.warrantyMonths),
            performanceWarrantyEndDate: addMonths(unit.product.performanceWarrantyMonths),
          },
        });
      }
    }

    // If a deposit was previously invoiced, register it as a credit line
    if (invoicedSoFar > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.invoiceItem.create({
          data: {
            invoiceId: inv.id,
            description: `Less: previously invoiced on ${so.number}`,
            quantity: 1,
            unitPrice: -invoicedSoFar,
            lineTotal: -invoicedSoFar,
          },
        });
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            subtotal: round2(Number(inv.subtotal) - invoicedSoFar),
            total: round2(Number(inv.total) - invoicedSoFar),
          },
        });
      });
    }
    return this.findOne(inv.id);
  }

  /** Set an installment plan on an invoice. */
  async setSchedule(userId: string, invoiceId: string, installments: { dueDate: string; amount: number }[]) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const sum = round2(installments.reduce((s, i) => s + i.amount, 0));
    if (Math.abs(sum - Number(inv.total)) > 0.01)
      throw new BadRequestException(`Installments (${sum}) must sum to the invoice total (${inv.total})`);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentSchedule.deleteMany({ where: { invoiceId } });
      await tx.paymentSchedule.createMany({
        data: installments.map((i, idx) => ({
          invoiceId,
          installmentNo: idx + 1,
          dueDate: new Date(i.dueDate),
          amount: i.amount,
        })),
      });
    });
    await this.audit.log(userId, 'SET_SCHEDULE', 'Invoice', invoiceId, { installments: installments.length });
    return this.findOne(invoiceId);
  }

  async cancel(userId: string, id: string) {
    const inv = await this.prisma.invoice.findUnique({ relationLoadStrategy: 'join', where: { id }, include: { payments: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (Number(inv.paidAmount) > 0) throw new BadRequestException('Invoice has payments — refund them first');
    await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.prisma.productUnit.updateMany({
      where: { invoiceId: id },
      data: { invoiceId: null, status: 'IN_STOCK', warrantyStartDate: null, warrantyEndDate: null, performanceWarrantyEndDate: null },
    });
    await this.audit.log(userId, 'CANCEL', 'Invoice', id, { number: inv.number });
    return { success: true };
  }

  /** Recompute paid amount and status from payments; used by payments module. */
  async refreshPaymentStatus(tx: Prisma.TransactionClient, invoiceId: string) {
    const inv = await tx.invoice.findUnique({ relationLoadStrategy: 'join',
      where: { id: invoiceId },
      include: { payments: { where: { deletedAt: null } } },
    });
    if (!inv) return;
    const paid = round2(inv.payments.reduce((s, p) => s + Number(p.amount) * Number(p.exchangeRate) / Number(inv.exchangeRate || 1), 0));
    let status = inv.status;
    if (inv.status !== 'CANCELLED') {
      if (paid >= Number(inv.total) - 0.01) status = 'PAID';
      else if (paid > 0) status = 'PARTIALLY_PAID';
      else if (inv.dueDate && inv.dueDate < new Date()) status = 'OVERDUE';
      else status = 'UNPAID';
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount: paid, status } });
  }
}
