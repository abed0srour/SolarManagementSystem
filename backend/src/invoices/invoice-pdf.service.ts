import { Injectable, NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoicePdfService {
  constructor(private prisma: PrismaService) {}

  async generate(invoiceId: string): Promise<Uint8Array> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: { include: { addresses: true } },
        supplier: true,
        items: { include: { product: { select: { sku: true } } } },
        schedules: { orderBy: { installmentNo: 'asc' } },
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const companySetting = await this.prisma.setting.findUnique({ where: { key: 'company' } });
    const company = (companySetting?.value as any) ?? { name: 'Solar Store' };

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const margin = 50;
    let y = 792;

    const text = (str: string, x: number, size = 10, isBold = false, color = rgb(0.15, 0.15, 0.2)) => {
      page.drawText(str ?? '', { x, y, size, font: isBold ? bold : font, color });
    };
    const money = (n: any) => `${Number(n).toFixed(2)} ${inv.currency}`;

    // Header
    text(company.name ?? 'Solar Store', margin, 20, true, rgb(0.9, 0.55, 0.1));
    text(inv.type === 'SALE' ? 'INVOICE' : 'PURCHASE INVOICE', 400, 20, true);
    y -= 18;
    if (company.address) { text(company.address, margin, 9); }
    text(`No: ${inv.number}`, 400, 10, true);
    y -= 14;
    if (company.phone) { text(`Tel: ${company.phone}`, margin, 9); }
    text(`Date: ${inv.issueDate.toISOString().slice(0, 10)}`, 400, 10);
    y -= 14;
    if (company.taxNumber) { text(`Tax No: ${company.taxNumber}`, margin, 9); }
    if (inv.dueDate) text(`Due: ${inv.dueDate.toISOString().slice(0, 10)}`, 400, 10);
    y -= 14;
    text(`Status: ${inv.status.replace('_', ' ')}`, 400, 10);

    // Bill to
    y -= 30;
    const party = inv.type === 'SALE' ? inv.client : inv.supplier;
    text(inv.type === 'SALE' ? 'Bill To:' : 'Supplier:', margin, 11, true);
    y -= 14;
    text(party?.name ?? '-', margin, 11);
    y -= 13;
    if (inv.type === 'SALE' && inv.client?.addresses?.length) {
      const addr = inv.client.addresses.find((a) => a.isBilling) ?? inv.client.addresses[0];
      text(`${addr.line1}${addr.city ? ', ' + addr.city : ''}`, margin, 9);
      y -= 12;
    }
    if (party && 'phone' in party && party.phone) { text(`Tel: ${party.phone}`, margin, 9); y -= 12; }
    const taxNo = inv.type === 'SALE' ? inv.client?.taxNumber : inv.supplier?.taxId;
    if (taxNo) { text(`Tax No: ${taxNo}`, margin, 9); y -= 12; }

    // Table header
    y -= 20;
    page.drawRectangle({ x: margin, y: y - 4, width: 495, height: 18, color: rgb(0.93, 0.93, 0.95) });
    text('#', margin + 4, 9, true);
    text('Description', margin + 24, 9, true);
    text('Qty', 330, 9, true);
    text('Unit Price', 370, 9, true);
    text('Disc.', 440, 9, true);
    text('Total', 490, 9, true);
    y -= 20;

    inv.items.forEach((item, idx) => {
      if (y < 140) {
        page = pdf.addPage([595, 842]);
        y = 792;
      }
      text(String(idx + 1), margin + 4, 9);
      const desc = item.description.length > 52 ? item.description.slice(0, 52) + '…' : item.description;
      text(`${item.product?.sku ? '[' + item.product.sku + '] ' : ''}${desc}`.slice(0, 58), margin + 24, 9);
      text(String(item.quantity), 330, 9);
      text(Number(item.unitPrice).toFixed(2), 370, 9);
      const disc = item.discountType
        ? item.discountType === 'PERCENT'
          ? `${Number(item.discountValue)}%`
          : Number(item.discountValue).toFixed(2)
        : '-';
      text(disc, 440, 9);
      text(Number(item.lineTotal).toFixed(2), 490, 9);
      y -= 16;
    });

    // Totals
    y -= 10;
    page.drawLine({ start: { x: 350, y: y + 8 }, end: { x: 545, y: y + 8 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    text('Subtotal:', 390, 10);
    text(money(inv.subtotal), 470, 10);
    y -= 15;
    if (inv.discountType) {
      const d = inv.discountType === 'PERCENT' ? `${Number(inv.discountValue)}%` : money(inv.discountValue);
      text(`Discount (${d}):`, 390, 10);
      y -= 15;
    }
    if (Number(inv.taxAmount) > 0) {
      text('Tax:', 390, 10);
      text(money(inv.taxAmount), 470, 10);
      y -= 15;
    }
    if (Number(inv.shippingFee) > 0) {
      text('Shipping:', 390, 10);
      text(money(inv.shippingFee), 470, 10);
      y -= 15;
    }
    text('Total:', 390, 12, true);
    text(money(inv.total), 470, 12, true);
    y -= 15;
    if (Number(inv.paidAmount) > 0) {
      text('Paid:', 390, 10);
      text(money(inv.paidAmount), 470, 10);
      y -= 15;
      text('Balance Due:', 390, 11, true);
      text(money(Number(inv.total) - Number(inv.paidAmount)), 470, 11, true);
      y -= 15;
    }

    // Payment schedule
    if (inv.schedules.length) {
      y -= 15;
      text('Payment Schedule:', margin, 11, true);
      y -= 15;
      for (const s of inv.schedules) {
        text(
          `Installment ${s.installmentNo}: ${money(s.amount)} due ${s.dueDate.toISOString().slice(0, 10)} (${s.status})`,
          margin + 10,
          9,
        );
        y -= 13;
      }
    }

    if (inv.notes) {
      y -= 15;
      text('Notes:', margin, 10, true);
      y -= 13;
      text(inv.notes.slice(0, 100), margin, 9);
    }

    // Footer
    page.drawText('Thank you for your business!', {
      x: margin,
      y: 40,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    return pdf.save();
  }
}
