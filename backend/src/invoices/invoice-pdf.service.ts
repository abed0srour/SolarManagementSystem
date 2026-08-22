import { Injectable, NotFoundException } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage';

const DARK = rgb(0.13, 0.15, 0.19);
const GRAY = rgb(0.45, 0.48, 0.53);
const LIGHT = rgb(0.82, 0.84, 0.87);
const BAND = rgb(0.955, 0.96, 0.97);

@Injectable()
export class InvoicePdfService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private async company() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'company' } });
    return (setting?.value as any) ?? { name: 'Solar Store' };
  }

  /** Try to embed the company logo (uploaded via settings) into the document. */
  private async embedLogo(pdf: PDFDocument, logoUrl?: string) {
    if (!logoUrl) return null;
    try {
      // The stored logo path is an absolute blob URL in production and an
      // app-relative path locally, so go through storage by filename either way.
      const bytes = await this.storage.get(`uploads/${basename(logoUrl)}`);
      if (!bytes) return null;
      const lower = logoUrl.toLowerCase();
      return lower.endsWith('.png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  private fmtDate(d: Date) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /**
   * Shared page header: logo on the left, document title and company details on
   * the right, the two centred against each other so they read as one row.
   *
   * The logo is centred on the right-hand block rather than pinned to a
   * baseline, because the two columns are different heights and change
   * independently — a banner logo is 60pt tall, a square one 133pt, and the
   * address block grows a line at a time as the company fills in its details.
   * Centring is the only rule that keeps them level through all of that.
   *
   * A logo taller than the text block would centre its way off the top of the
   * page, so the position is clamped to the top margin; past that point the
   * logo simply hangs from the margin and the text block is the shorter of the
   * two. When a long address would reach into the logo the header falls back to
   * stacking the block underneath it — the columns only share a row while there
   * is genuinely room for both.
   */
  private async header(pdf: PDFDocument, page: PDFPage, fonts: { font: PDFFont; bold: PDFFont }, title: string, company: any) {
    const { font, bold } = fonts;
    const width = page.getWidth();
    const right = (str: string, y: number, size: number, f: PDFFont, color = GRAY) =>
      page.drawText(str, { x: width - 50 - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    const infoLines = [company.name, company.address, company.phone, company.email].filter(Boolean).map(String);
    const logo = await this.embedLogo(pdf, company.logoUrl);
    const scale = logo ? Math.min(280 / logo.width, 133.3 / logo.height) : 0;
    const w = logo ? logo.width * scale : 0;
    const h = logo ? logo.height * scale : 0;

    // Where the right-hand block starts, measured from its widest line, against
    // where the logo ends. 14pt is the narrowest gap that still reads as two
    // columns rather than as collision.
    const widest = Math.max(bold.widthOfTextAtSize(title, 24), ...infoLines.map((l) => font.widthOfTextAtSize(l, 10)));
    const shareRow = !logo || width - 50 - widest > 50 + w + 14;

    let titleY = 762;
    let logoBottom = 786;
    if (logo) {
      if (shareRow) {
        // 786 is the visual top of the 24pt title; the block ends 4pt under the
        // last address line.
        const blockBottom = 742 - 14 * Math.max(0, infoLines.length - 1) - 4;
        logoBottom = Math.min(806 - h, (786 + blockBottom) / 2 - h / 2);
      } else {
        logoBottom = 806 - h;
        titleY = logoBottom - 34;
      }
      page.drawImage(logo, { x: 50, y: logoBottom, width: w, height: h });
    } else {
      page.drawText(company.name ?? 'Solar Store', { x: 50, y: 760, size: 18, font: bold, color: rgb(0.9, 0.45, 0.1) });
    }

    right(title, titleY, 24, bold, DARK);
    let hy = titleY - 20;
    for (const line of infoLines) {
      right(line, hy, 10, font);
      hy -= 14;
    }
    /*
     * y below the header block — the lower of the two columns, since a tall logo
     * can reach further down than the address does. Without a logo the band
     * stays at 700 where it always sat.
     */
    return Math.min(700, hy - 8, logo ? logoBottom - 16 : 700);
  }

  /** Gray info band with a left block and a right block of label/value rows. */
  private band(
    page: PDFPage,
    fonts: { font: PDFFont; bold: PDFFont },
    yTop: number,
    left: { label: string; rows: { text: string; bold?: boolean; size?: number }[] },
    rightRows: { label: string; value: string }[],
    rightLabel: string,
  ) {
    const { font, bold } = fonts;
    const width = page.getWidth();
    const height = 30 + Math.max(left.rows.length, rightRows.length) * 18 + 14;
    page.drawRectangle({ x: 30, y: yTop - height, width: width - 60, height, color: BAND });

    let y = yTop - 24;
    page.drawText(left.label.toUpperCase(), { x: 50, y, size: 9, font: bold, color: GRAY });
    const rightAt = (str: string, ry: number, size: number, f: PDFFont, color = DARK) =>
      page.drawText(str, { x: width - 50 - f.widthOfTextAtSize(str, size), y: ry, size, font: f, color });
    rightAt(rightLabel.toUpperCase(), y, 9, bold, GRAY);

    y -= 20;
    let ly = y;
    for (const row of left.rows) {
      page.drawText(row.text, { x: 50, y: ly, size: row.size ?? 11, font: row.bold ? bold : font, color: DARK });
      ly -= 18;
    }
    let ry = y;
    for (const row of rightRows) {
      const valueW = bold.widthOfTextAtSize(row.value, 11);
      rightAt(row.value, ry, 11, bold);
      page.drawText(row.label, {
        x: page.getWidth() - 50 - valueW - 8 - font.widthOfTextAtSize(row.label, 10),
        y: ry,
        size: 10,
        font,
        color: GRAY,
      });
      ry -= 18;
    }
    return yTop - height - 24;
  }

  private footer(page: PDFPage, fonts: { font: PDFFont; bold: PDFFont }, company: any, thanks: string) {
    const { font, bold } = fonts;
    const width = page.getWidth();
    page.drawLine({ start: { x: 50, y: 110 }, end: { x: width - 50, y: 110 }, thickness: 0.5, color: LIGHT });
    page.drawText(thanks, { x: 50, y: 92, size: 9, font, color: GRAY });
    const name = company.name ?? 'Solar Store';
    page.drawText(name, { x: width - 50 - bold.widthOfTextAtSize(name, 12), y: 62, size: 12, font: bold, color: DARK });
    const date = this.fmtDate(new Date());
    page.drawText(date, { x: width - 50 - font.widthOfTextAtSize(date, 9), y: 48, size: 9, font, color: GRAY });
  }

  async generate(invoiceId: string): Promise<Uint8Array> {
    const inv = await this.prisma.invoice.findUnique({ relationLoadStrategy: 'join',
      where: { id: invoiceId },
      include: {
        client: { include: { addresses: true } },
        supplier: true,
        salesOrder: { select: { number: true } },
        // Only top-level lines are billed. A bundle's components hang off their
        // parent and are printed only when the client asked for a breakdown.
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true } },
            subItems: { orderBy: { id: 'asc' }, include: { product: { select: { name: true } } } },
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const company = await this.company();

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fonts = { font, bold };
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n).toFixed(2)}`;
    // Quantities are decimal now (12.5 m of cable), but whole numbers must not
    // print as "8.000" on a customer's invoice.
    const qty = (n: any) => {
      const v = Number(n);
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3)));
    };
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = DARK) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Invoice', company);

    const party = inv.type === 'SALE' ? inv.client : inv.supplier;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party && 'phone' in party && party.phone) partyRows.push({ text: party.phone });
    y = this.band(
      page,
      fonts,
      y,
      { label: 'Bill to', rows: partyRows },
      [
        { label: 'Invoice #', value: inv.number.replace(/^\D+/, '') || inv.number },
        { label: 'Date', value: this.fmtDate(inv.issueDate) },
      ],
      'Bill info',
    );

    // Items table
    const colQty = 360;
    const colPrice = 460;
    const colAmount = width - 50;
    page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: width - 40, y: y + 6 }, thickness: 1, color: LIGHT });
    y -= 16;
    page.drawText('Item', { x: 50, y, size: 11, font: bold, color: DARK });
    rightAt('Quantity', colQty, y, 11, bold);
    rightAt('Price', colPrice, y, 11, bold);
    rightAt('Amount', colAmount, y, 11, bold);
    y -= 10;
    page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: LIGHT });
    y -= 22;

    for (const item of inv.items) {
      if (y < 200) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }
      // A catalogue line prints the product's current name, so renaming a product
      // in the catalogue shows up the next time the invoice is downloaded. The
      // stored description is the fallback for lines typed by hand — bundle
      // headers, deposits, credits — which carry no product of their own.
      const name = item.product?.name || item.description;
      const desc = name.length > 55 ? name.slice(0, 55) + '…' : name;
      page.drawText(desc, { x: 50, y, size: 10.5, font, color: DARK });
      rightAt(qty(item.quantity), colQty, y, 10.5, font);
      rightAt(money(item.unitPrice), colPrice, y, 10.5, font);
      rightAt(money(item.lineTotal), colAmount, y, 10.5, font);
      y -= 12;

      /*
       * A bundle prints as one line by default — the customer sees "AC & DC
       * Protection Components" and a single price, not thirty fittings. The
       * breakdown is printed only when the invoice carries the opt-in flag,
       * and then without prices, because the components' value is already in
       * the parent's amount and repeating it would look like double billing.
       */
      if (inv.showSubItemsOnInvoice && item.subItems?.length) {
        for (const sub of item.subItems) {
          if (y < 120) {
            page = pdf.addPage([595, 842]);
            y = 780;
          }
          const unit = sub.unit ? ` ${sub.unit}` : '';
          const subName = sub.product?.name || sub.description;
          const label = `• ${subName}  (${qty(sub.quantity)}${unit})`;
          page.drawText(label.length > 70 ? label.slice(0, 70) + '…' : label, {
            x: 62, y, size: 9, font, color: GRAY,
          });
          y -= 13;
        }
        y -= 4;
      }

      page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: LIGHT });
      y -= 20;
    }

    // Totals
    y -= 6;
    /*
     * Up to five rows at 26pt each, and the footer owns everything below y=110.
     * Worth checking now that the taller logo pushes the table further down the
     * first page: a total printed across the footer rule is the one line on the
     * document nobody can afford to have land in the wrong place.
     */
    if (y < 260) {
      page = pdf.addPage([595, 842]);
      y = 780;
    }
    const totalRow = (label: string, value: string, isBold = false, size = 11) => {
      rightAt(label, colPrice, y, size, isBold ? bold : font, isBold ? DARK : GRAY);
      rightAt(value, colAmount, y, size, bold);
      y -= 8;
      page.drawLine({ start: { x: colQty - 40, y }, end: { x: width - 50, y }, thickness: 0.5, color: LIGHT });
      y -= 18;
    };
    totalRow('Subtotal', money(inv.subtotal));
    if (inv.discountType) {
      const d = inv.discountType === 'PERCENT' ? `${Number(inv.discountValue)}%` : money(inv.discountValue);
      totalRow(`Discount (${d})`, '');
    }
    if (Number(inv.shippingFee) > 0) totalRow('Shipping', money(inv.shippingFee));
    totalRow('Total', money(inv.total), true, 12);
    if (Number(inv.paidAmount) > 0) {
      totalRow('Paid', money(inv.paidAmount));
      totalRow('Balance due', money(Number(inv.total) - Number(inv.paidAmount)), true);
    }

    this.footer(
      page,
      fonts,
      company,
      `Thank you for choosing ${company.name ?? 'us'}. We appreciate your business and look forward to serving you again.`,
    );
    return pdf.save();
  }

  /** Receipt for a payment (incoming money) in the same visual style. */
  async receipt(paymentId: string): Promise<Uint8Array> {
    const p = await this.prisma.payment.findUnique({ relationLoadStrategy: 'join',
      where: { id: paymentId },
      include: {
        client: true,
        supplier: true,
        invoice: { select: { number: true, total: true, paidAmount: true, salesOrder: { select: { number: true } } } },
        purchaseOrder: { select: { number: true } },
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const company = await this.company();

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fonts = { font, bold };
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n).toFixed(2)}`;
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = DARK) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Receipt', company);

    const party = p.client ?? p.supplier;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party?.phone) partyRows.push({ text: party.phone });
    y = this.band(
      page,
      fonts,
      y,
      { label: p.direction === 'INCOMING' ? 'Received from' : 'Paid to', rows: partyRows },
      [
        { label: 'Receipt #', value: p.number.replace(/^\D+/, '') || p.number },
        { label: 'Date', value: this.fmtDate(p.paymentDate) },
        { label: 'Method', value: p.method.replace(/_/g, ' ') },
      ],
      'Receipt info',
    );

    // Payment line
    const ref =
      p.invoice?.salesOrder?.number
        ? `Payment on order ${p.invoice.salesOrder.number}`
        : p.purchaseOrder?.number
          ? `Payment on purchase order ${p.purchaseOrder.number}`
          : p.invoice?.number
            ? `Payment on invoice ${p.invoice.number}`
            : 'Payment';
    page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: width - 40, y: y + 6 }, thickness: 1, color: LIGHT });
    y -= 16;
    page.drawText('Description', { x: 50, y, size: 11, font: bold, color: DARK });
    rightAt('Amount', width - 50, y, 11, bold);
    y -= 10;
    page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: LIGHT });
    y -= 22;
    page.drawText(ref, { x: 50, y, size: 10.5, font, color: DARK });
    if (p.reference) {
      page.drawText(`Ref: ${p.reference}`, { x: 50, y: y - 14, size: 9, font, color: GRAY });
    }
    rightAt(money(p.amount), width - 50, y, 10.5, font);
    y -= p.reference ? 26 : 12;
    page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: LIGHT });
    y -= 24;

    rightAt('Total received', 460, y, 12, bold);
    rightAt(money(p.amount), width - 50, y, 12, bold);
    if (p.invoice) {
      y -= 24;
      const remaining = Math.max(0, Number(p.invoice.total) - Number(p.invoice.paidAmount));
      rightAt('Remaining balance', 460, y, 10, font, GRAY);
      rightAt(money(remaining), width - 50, y, 10, bold);
    }

    this.footer(page, fonts, company, `Thank you for choosing ${company.name ?? 'us'}. This receipt confirms your payment.`);
    return pdf.save();
  }

  /** Quotation / Estimate document in the same clean visual style. */
  async quotation(quotationId: string): Promise<Uint8Array> {
    const q = await this.prisma.quotation.findUnique({
      relationLoadStrategy: 'join',
      where: { id: quotationId },
      include: {
        client: { include: { addresses: true } },
        items: {
          where: { parentItemId: null },
          include: {
            product: { select: { sku: true, name: true } },
            subItems: { orderBy: { id: 'asc' }, include: { product: { select: { sku: true, name: true } } } },
          },
        },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    const company = await this.company();

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fonts = { font, bold };
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n).toFixed(2)}`;
    const qty = (n: any) => {
      const v = Number(n);
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3)));
    };
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = DARK) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Quotation', company);

    const party = q.client;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party?.phone) partyRows.push({ text: party.phone });
    if (party?.email) partyRows.push({ text: party.email });
    if (party?.addresses?.[0]?.line1) partyRows.push({ text: party.addresses[0].line1 });

    const rightMeta = [
      { label: 'Quotation #', value: q.number.replace(/^\D+/, '') || q.number },
      { label: 'Date', value: this.fmtDate(q.createdAt) },
    ];
    if (q.validUntil) {
      rightMeta.push({ label: 'Valid until', value: this.fmtDate(q.validUntil) });
    }

    y = this.band(
      page,
      fonts,
      y,
      { label: 'Quote to', rows: partyRows },
      rightMeta,
      'Quote info',
    );

    // Items table
    const colQty = 360;
    const colPrice = 460;
    const colAmount = width - 50;
    page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: width - 40, y: y + 6 }, thickness: 1, color: LIGHT });
    y -= 16;
    page.drawText('Item', { x: 50, y, size: 11, font: bold, color: DARK });
    rightAt('Quantity', colQty, y, 11, bold);
    rightAt('Unit Price', colPrice, y, 11, bold);
    rightAt('Amount', colAmount, y, 11, bold);
    y -= 10;
    page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: LIGHT });
    y -= 22;

    for (const item of q.items) {
      if (y < 200) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }
      const name = item.product?.name || item.description || 'Custom Item';
      const desc = name.length > 55 ? name.slice(0, 55) + '…' : name;
      page.drawText(desc, { x: 50, y, size: 10.5, font, color: DARK });
      rightAt(qty(item.quantity), colQty, y, 10.5, font);
      rightAt(money(item.unitPrice), colPrice, y, 10.5, font);
      rightAt(money(item.lineTotal), colAmount, y, 10.5, font);
      y -= 12;

      if (item.subItems?.length) {
        for (const sub of item.subItems) {
          if (y < 120) {
            page = pdf.addPage([595, 842]);
            y = 780;
          }
          const subName = sub.product?.name || sub.description || 'Component';
          const label = `• ${subName}  (${qty(sub.quantity)})`;
          page.drawText(label.length > 70 ? label.slice(0, 70) + '…' : label, {
            x: 62, y, size: 9, font, color: GRAY,
          });
          y -= 13;
        }
        y -= 4;
      }

      page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: LIGHT });
      y -= 20;
    }

    // Totals
    y -= 6;
    if (y < 240) {
      page = pdf.addPage([595, 842]);
      y = 780;
    }
    const totalRow = (label: string, value: string, isBold = false, size = 11) => {
      rightAt(label, colPrice, y, size, isBold ? bold : font, isBold ? DARK : GRAY);
      rightAt(value, colAmount, y, size, bold);
      y -= 8;
      page.drawLine({ start: { x: colQty - 40, y }, end: { x: width - 50, y }, thickness: 0.5, color: LIGHT });
      y -= 18;
    };
    totalRow('Subtotal', money(q.subtotal));
    if (q.discountType && Number(q.discountValue) > 0) {
      const d = q.discountType === 'PERCENT' ? `${Number(q.discountValue)}%` : money(q.discountValue);
      const discountVal =
        q.discountType === 'PERCENT' ? Number(q.subtotal) * (Number(q.discountValue) / 100) : Number(q.discountValue);
      totalRow(`Discount (${d})`, `-${money(discountVal)}`);
    }
    totalRow('Total Quote', money(q.total), true, 12);

    if (q.notes) {
      y -= 10;
      page.drawText('Notes / Terms:', { x: 50, y, size: 10, font: bold, color: DARK });
      y -= 14;
      const noteLines = q.notes.split('\n').slice(0, 4);
      for (const nl of noteLines) {
        page.drawText(nl.length > 80 ? nl.slice(0, 80) + '…' : nl, { x: 50, y, size: 9, font, color: GRAY });
        y -= 12;
      }
    }

    this.footer(
      page,
      fonts,
      company,
      `Thank you for considering ${company.name ?? 'us'}. This quote is valid until ${q.validUntil ? this.fmtDate(q.validUntil) : '30 days from issue'}.`,
    );
    return pdf.save();
  }

  /** Aggregates ledger data for client statement (used for PDF and JSON API). */
  async getClientStatementData(
    clientId: string,
    options: { mode?: 'FULL' | 'PAYMENTS'; startDate?: Date; endDate?: Date } = {},
  ) {
    const { mode = 'FULL', startDate, endDate } = options;
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { addresses: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (mode === 'PAYMENTS') {
      const payments = await this.prisma.payment.findMany({
        where: {
          clientId,
          direction: 'INCOMING',
          deletedAt: null,
          ...(startDate && { paymentDate: { gte: startDate } }),
          ...(endDate && { paymentDate: { lte: endDate } }),
        },
        include: {
          invoice: { select: { id: true, number: true, total: true } },
        },
        orderBy: { paymentDate: 'asc' },
      });

      const entries = payments.map((p) => ({
        id: p.id,
        date: p.paymentDate,
        number: p.number,
        method: p.method,
        reference: p.reference || null,
        invoiceNumber: p.invoice?.number || null,
        invoiceId: p.invoice?.id || null,
        notes: p.notes || null,
        amount: Number(p.amount),
        currency: p.currency,
      }));

      const totalPaid = entries.reduce((s, e) => s + e.amount, 0);

      return {
        client,
        mode: 'PAYMENTS' as const,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
        entries,
        totalPaymentsCount: entries.length,
        totalAmountPaid: totalPaid,
      };
    }

    // MODE A: FULL STATEMENT
    let openingBalance = 0;
    if (startDate) {
      const [prevInvoices, prevPayments] = await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            clientId,
            type: 'SALE',
            status: { not: 'CANCELLED' },
            deletedAt: null,
            issueDate: { lt: startDate },
          },
          _sum: { total: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            clientId,
            direction: 'INCOMING',
            deletedAt: null,
            paymentDate: { lt: startDate },
          },
          _sum: { amount: true },
        }),
      ]);
      openingBalance = Number(prevInvoices._sum.total ?? 0) - Number(prevPayments._sum.amount ?? 0);
    }

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          clientId,
          type: 'SALE',
          status: { not: 'CANCELLED' },
          deletedAt: null,
          ...(startDate && { issueDate: { gte: startDate } }),
          ...(endDate && { issueDate: { lte: endDate } }),
        },
        include: {
          items: {
            where: { parentItemId: null },
            include: {
              product: { select: { sku: true, name: true } },
              subItems: { include: { product: { select: { name: true } } } },
            },
          },
        },
        orderBy: { issueDate: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: {
          clientId,
          direction: 'INCOMING',
          deletedAt: null,
          ...(startDate && { paymentDate: { gte: startDate } }),
          ...(endDate && { paymentDate: { lte: endDate } }),
        },
        include: {
          invoice: { select: { id: true, number: true } },
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    type LedgerRaw = {
      id: string;
      date: Date;
      type: 'INVOICE' | 'PAYMENT';
      ref: string;
      description: string;
      debit: number;
      credit: number;
      itemsSummary?: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
    };

    const raw: LedgerRaw[] = [
      ...invoices.map((inv) => ({
        id: inv.id,
        date: inv.issueDate,
        type: 'INVOICE' as const,
        ref: inv.number,
        description: `Invoice #${inv.number}${inv.notes ? ` — ${inv.notes}` : ''}`,
        debit: Number(inv.total),
        credit: 0,
        itemsSummary: inv.items.map((it) => ({
          name: it.product?.name || it.description || 'Item',
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          lineTotal: Number(it.lineTotal),
        })),
      })),
      ...payments.map((p) => ({
        id: p.id,
        date: p.paymentDate,
        type: 'PAYMENT' as const,
        ref: p.number,
        description: `Payment (${p.method}${p.reference ? ' · ' + p.reference : ''}${p.invoice ? ' for Inv #' + p.invoice.number : ''})`,
        debit: 0,
        credit: Number(p.amount),
      })),
    ];

    raw.sort((a, b) => {
      const ta = new Date(a.date).getTime();
      const tb = new Date(b.date).getTime();
      if (ta !== tb) return ta - tb;
      return a.type === 'INVOICE' ? -1 : 1;
    });

    let current = openingBalance;
    const entries = raw.map((r) => {
      current = current + r.debit - r.credit;
      return {
        ...r,
        runningBalance: current,
      };
    });

    const totalBilled = entries.reduce((s, e) => s + e.debit, 0);
    const totalPaid = entries.reduce((s, e) => s + e.credit, 0);
    const closingBalance = current;

    return {
      client,
      mode: 'FULL' as const,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
      openingBalance,
      entries,
      totalBilled,
      totalPaid,
      closingBalance,
    };
  }

  /** Generates a formatted PDF statement of account for a client. */
  async clientStatement(
    clientId: string,
    options: { mode?: 'FULL' | 'PAYMENTS'; startDate?: Date; endDate?: Date } = {},
  ): Promise<Uint8Array> {
    const data = await this.getClientStatementData(clientId, options);
    const company = await this.company();

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fonts = { font, bold };
    const width = page.getWidth();

    const money = (n: any) =>
      `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = DARK) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    const isFull = data.mode === 'FULL';
    const docTitle = isFull ? 'Account Statement' : 'Payment History';

    let y = await this.header(pdf, page, fonts, docTitle, company);

    const client = data.client;
    const mainAddr = client.addresses?.find((a: any) => a.isBilling) || client.addresses?.[0];
    const clientRows: { text: string; bold?: boolean }[] = [{ text: client.name, bold: true }];
    if (client.phone) clientRows.push({ text: client.phone });
    if (client.email) clientRows.push({ text: client.email });
    if (mainAddr) clientRows.push({ text: [mainAddr.line1, mainAddr.city].filter(Boolean).join(', ') });

    const periodStr =
      options.startDate && options.endDate
        ? `${this.fmtDate(options.startDate)} – ${this.fmtDate(options.endDate)}`
        : options.startDate
          ? `From ${this.fmtDate(options.startDate)}`
          : options.endDate
            ? `Up to ${this.fmtDate(options.endDate)}`
            : 'All Recorded History';

    const metaRows: { label: string; value: string }[] = [
      { label: 'Date', value: this.fmtDate(new Date()) },
      { label: 'Period', value: periodStr },
      { label: 'Account Type', value: `${client.type || 'Standard'} · ${client.tier || 'Retail'}` },
    ];
    if (Number(client.creditLimit) > 0) {
      metaRows.push({ label: 'Credit Limit', value: money(client.creditLimit) });
    }

    y = this.band(
      page,
      fonts,
      y,
      { label: 'Client / Account', rows: clientRows },
      metaRows,
      'Statement Details',
    );

    // Summary Highlight Cards
    if (isFull) {
      const fullData = data as any;
      const boxW = (width - 70) / 4;
      const boxH = 42;
      const metrics = [
        { label: 'OPENING BALANCE', value: money(fullData.openingBalance), highlight: false },
        { label: 'TOTAL INVOICED', value: money(fullData.totalBilled), highlight: false },
        { label: 'TOTAL PAID', value: money(fullData.totalPaid), highlight: false },
        { label: 'NET OUTSTANDING', value: money(fullData.closingBalance), highlight: true },
      ];

      metrics.forEach((m, idx) => {
        const bx = 35 + idx * (boxW + 4);
        page.drawRectangle({
          x: bx,
          y: y - boxH,
          width: boxW,
          height: boxH,
          color: m.highlight ? rgb(0.98, 0.94, 0.9) : BAND,
          borderColor: m.highlight ? rgb(0.9, 0.5, 0.1) : LIGHT,
          borderWidth: m.highlight ? 1 : 0.5,
        });
        page.drawText(m.label, { x: bx + 8, y: y - 14, size: 7.5, font: bold, color: GRAY });
        page.drawText(m.value, {
          x: bx + 8,
          y: y - 32,
          size: 11,
          font: bold,
          color: m.highlight && Number(fullData.closingBalance) > 0 ? rgb(0.85, 0.25, 0.1) : DARK,
        });
      });
      y -= boxH + 16;
    } else {
      const payData = data as any;
      const boxW = (width - 70) / 2;
      const boxH = 40;
      const metrics = [
        { label: 'TOTAL PAYMENTS COUNT', value: `${payData.totalPaymentsCount} transactions` },
        { label: 'TOTAL AMOUNT RECEIVED', value: money(payData.totalAmountPaid) },
      ];
      metrics.forEach((m, idx) => {
        const bx = 35 + idx * (boxW + 6);
        page.drawRectangle({
          x: bx,
          y: y - boxH,
          width: boxW,
          height: boxH,
          color: BAND,
          borderColor: LIGHT,
          borderWidth: 0.5,
        });
        page.drawText(m.label, { x: bx + 10, y: y - 14, size: 8, font: bold, color: GRAY });
        page.drawText(m.value, { x: bx + 10, y: y - 32, size: 12, font: bold, color: DARK });
      });
      y -= boxH + 16;
    }

    // Draw Table
    if (isFull) {
      const fullData = data as any;
      const colDate = 45;
      const colRef = 125;
      const colDebit = 370;
      const colCredit = 455;
      const colBal = width - 45;

      const drawTableHeader = (p: PDFPage, curY: number) => {
        p.drawLine({ start: { x: 35, y: curY + 6 }, end: { x: width - 35, y: curY + 6 }, thickness: 1, color: LIGHT });
        curY -= 15;
        p.drawText('Date', { x: colDate, y: curY, size: 9, font: bold, color: DARK });
        p.drawText('Transaction / Ref #', { x: colRef, y: curY, size: 9, font: bold, color: DARK });
        rightAt('Invoiced (+)', colDebit, curY, 9, bold);
        rightAt('Paid (-)', colCredit, curY, 9, bold);
        rightAt('Balance', colBal, curY, 9, bold);
        curY -= 8;
        p.drawLine({ start: { x: 35, y: curY }, end: { x: width - 35, y: curY }, thickness: 1, color: LIGHT });
        return curY - 14;
      };

      y = drawTableHeader(page, y);

      // Opening balance row if start date is given
      if (options.startDate) {
        page.drawText(this.fmtDate(options.startDate), { x: colDate, y, size: 8.5, font, color: GRAY });
        page.drawText('Opening Forward Balance', { x: colRef, y, size: 8.5, font: bold, color: GRAY });
        rightAt('—', colDebit, y, 8.5, font, GRAY);
        rightAt('—', colCredit, y, 8.5, font, GRAY);
        rightAt(money(fullData.openingBalance), colBal, y, 9, bold, DARK);
        y -= 6;
        page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: LIGHT });
        y -= 12;
      }

      if (fullData.entries.length === 0) {
        page.drawText('No transactions recorded within this period.', {
          x: 45,
          y,
          size: 9.5,
          font,
          color: GRAY,
        });
        y -= 20;
      }

      for (const e of fullData.entries) {
        if (y < 100) {
          page = pdf.addPage([595, 842]);
          y = 790;
          y = drawTableHeader(page, y);
        }

        const dateStr = this.fmtDate(new Date(e.date));
        page.drawText(dateStr, { x: colDate, y, size: 8.5, font, color: DARK });

        const label = e.type === 'INVOICE' ? `Invoice #${e.ref}` : `Payment #${e.ref}`;
        page.drawText(label, {
          x: colRef,
          y,
          size: 8.5,
          font: e.type === 'INVOICE' ? font : bold,
          color: e.type === 'INVOICE' ? DARK : rgb(0.1, 0.5, 0.25),
        });

        rightAt(e.debit > 0 ? money(e.debit) : '—', colDebit, y, 8.5, font, e.debit > 0 ? DARK : GRAY);
        rightAt(e.credit > 0 ? money(e.credit) : '—', colCredit, y, 8.5, font, e.credit > 0 ? rgb(0.1, 0.55, 0.25) : GRAY);
        rightAt(money(e.runningBalance), colBal, y, 9, bold, DARK);

        y -= 6;
        page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: LIGHT });
        y -= 12;
      }

      // Closing Total Box
      if (y < 130) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }
      y -= 6;
      const sumBoxW = 230;
      const sumBoxH = 62;
      const bx = width - 35 - sumBoxW;
      page.drawRectangle({
        x: bx,
        y: y - sumBoxH,
        width: sumBoxW,
        height: sumBoxH,
        color: BAND,
        borderColor: LIGHT,
        borderWidth: 0.5,
      });

      page.drawText('Total Invoiced (Period):', { x: bx + 12, y: y - 16, size: 8.5, font, color: GRAY });
      rightAt(money(fullData.totalBilled), bx + sumBoxW - 12, y - 16, 8.5, bold, DARK);

      page.drawText('Total Paid (Period):', { x: bx + 12, y: y - 32, size: 8.5, font, color: GRAY });
      rightAt(money(fullData.totalPaid), bx + sumBoxW - 12, y - 32, 8.5, bold, rgb(0.1, 0.55, 0.25));

      page.drawLine({
        start: { x: bx + 12, y: y - 40 },
        end: { x: bx + sumBoxW - 12, y: y - 40 },
        thickness: 0.5,
        color: LIGHT,
      });

      page.drawText('Net Outstanding:', { x: bx + 12, y: y - 53, size: 9.5, font: bold, color: DARK });
      rightAt(
        money(fullData.closingBalance),
        bx + sumBoxW - 12,
        y - 53,
        10.5,
        bold,
        Number(fullData.closingBalance) > 0 ? rgb(0.85, 0.25, 0.1) : DARK,
      );

      y -= sumBoxH + 20;
    } else {
      // MODE B: PAYMENTS ONLY
      const payData = data as any;
      const colDate = 40;
      const colRef = 115;
      const colMethod = 190;
      const colInvoice = 275;
      const colNotes = 360;
      const colAmount = width - 40;

      const drawTableHeader = (p: PDFPage, curY: number) => {
        p.drawLine({ start: { x: 35, y: curY + 6 }, end: { x: width - 35, y: curY + 6 }, thickness: 1, color: LIGHT });
        curY -= 16;
        p.drawText('Date', { x: colDate, y: curY, size: 9.5, font: bold, color: DARK });
        p.drawText('Payment #', { x: colRef, y: curY, size: 9.5, font: bold, color: DARK });
        p.drawText('Method', { x: colMethod, y: curY, size: 9.5, font: bold, color: DARK });
        p.drawText('Invoice Ref', { x: colInvoice, y: curY, size: 9.5, font: bold, color: DARK });
        p.drawText('Reference / Notes', { x: colNotes, y: curY, size: 9.5, font: bold, color: DARK });
        rightAt('Amount Received', colAmount, curY, 9.5, bold);
        curY -= 8;
        p.drawLine({ start: { x: 35, y: curY }, end: { x: width - 35, y: curY }, thickness: 1, color: LIGHT });
        return curY - 16;
      };

      y = drawTableHeader(page, y);

      if (payData.entries.length === 0) {
        page.drawText('No payments found in this date range.', { x: 45, y, size: 10, font, color: GRAY });
        y -= 24;
      }

      for (const p of payData.entries) {
        if (y < 120) {
          page = pdf.addPage([595, 842]);
          y = 790;
          y = drawTableHeader(page, y);
        }

        const dateStr = this.fmtDate(new Date(p.date));
        page.drawText(dateStr, { x: colDate, y, size: 9, font, color: DARK });
        page.drawText(p.number, { x: colRef, y, size: 9, font: bold, color: DARK });
        page.drawText(p.method, { x: colMethod, y, size: 9, font, color: DARK });
        page.drawText(p.invoiceNumber || '—', { x: colInvoice, y, size: 9, font, color: p.invoiceNumber ? DARK : GRAY });

        const refText = [p.reference, p.notes].filter(Boolean).join(' · ');
        const refTrunc = refText ? (refText.length > 25 ? refText.slice(0, 25) + '…' : refText) : '—';
        page.drawText(refTrunc, { x: colNotes, y, size: 8.5, font, color: GRAY });

        rightAt(money(p.amount), colAmount, y, 9.5, bold, rgb(0.1, 0.55, 0.25));

        y -= 8;
        page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: LIGHT });
        y -= 14;
      }

      // Closing Total Box
      if (y < 140) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }
      y -= 8;
      const sumBoxW = 240;
      const sumBoxH = 46;
      const bx = width - 35 - sumBoxW;
      page.drawRectangle({
        x: bx,
        y: y - sumBoxH,
        width: sumBoxW,
        height: sumBoxH,
        color: BAND,
        borderColor: LIGHT,
        borderWidth: 0.5,
      });

      page.drawText('Total Payments Received:', { x: bx + 12, y: y - 28, size: 10, font: bold, color: DARK });
      rightAt(money(payData.totalAmountPaid), bx + sumBoxW - 12, y - 28, 12, bold, rgb(0.1, 0.55, 0.25));

      y -= sumBoxH + 24;
    }

    this.footer(
      page,
      fonts,
      company,
      `For billing inquiries, please contact ${company.email || company.phone || company.name || 'our support'}. Thank you for your business.`,
    );

    return pdf.save();
  }
}
