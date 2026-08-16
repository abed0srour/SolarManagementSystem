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
}
