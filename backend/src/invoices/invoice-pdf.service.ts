import { Injectable, NotFoundException } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { basename } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage';

export type HeaderLayout = 'MODERN_SPLIT' | 'CENTERED_BANNER' | 'CLEAN_MINIMAL';
export type TableStyle = 'STRIPED' | 'BORDERED' | 'MINIMAL_DIVIDERS';
export type FontFamilyOption = 'Helvetica' | 'TimesRoman' | 'Courier';
export type LogoSizeOption = 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE';
export type FontWeightOption = 'REGULAR' | 'BOLD' | 'EXTRA_BOLD';

export interface PdfThemeConfig {
  presetId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  darkColor?: string;
  grayColor?: string;
  lightColor?: string;
  bandColor?: string;
  headerLayout?: HeaderLayout;
  tableStyle?: TableStyle;
  fontFamily?: FontFamilyOption;
  fontWeight?: FontWeightOption;
  logoSize?: LogoSizeOption;
  logoScale?: number;
  footerNote?: string;
  showLogo?: boolean;
  showSignature?: boolean;
  signatureTitle?: string;
  signatureSignerName?: string;
  showWatermark?: boolean;
  watermarkText?: string;
}

export interface ResolvedPdfTheme {
  primary: ReturnType<typeof rgb>;
  secondary: ReturnType<typeof rgb>;
  dark: ReturnType<typeof rgb>;
  gray: ReturnType<typeof rgb>;
  light: ReturnType<typeof rgb>;
  band: ReturnType<typeof rgb>;
  headerLayout: HeaderLayout;
  tableStyle: TableStyle;
  fontFamily: FontFamilyOption;
  fontWeight: FontWeightOption;
  logoSize: LogoSizeOption;
  logoScale: number;
  footerNote?: string;
  showLogo: boolean;
  showSignature: boolean;
  signatureTitle?: string;
  signatureSignerName?: string;
  showWatermark?: boolean;
  watermarkText?: string;
}

export const PDF_PRESETS: Record<
  string,
  Required<
    Omit<
      PdfThemeConfig,
      'presetId' | 'footerNote' | 'watermarkText' | 'signatureTitle' | 'signatureSignerName'
    >
  >
> = {
  classic_default: {
    primaryColor: '#161615',
    secondaryColor: '#71717A',
    darkColor: '#161615',
    grayColor: '#71717A',
    lightColor: '#E4E4E7',
    bandColor: '#F4F4F5',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: false,
    showWatermark: false,
  },
  executive_slate: {
    primaryColor: '#1E293B',
    secondaryColor: '#475569',
    darkColor: '#0F172A',
    grayColor: '#64748B',
    lightColor: '#E2E8F0',
    bandColor: '#F1F5F9',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'EXTRA_BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
    showWatermark: false,
  },
  corporate_navy: {
    primaryColor: '#1E3A8A',
    secondaryColor: '#475569',
    darkColor: '#0F172A',
    grayColor: '#64748B',
    lightColor: '#CBD5E1',
    bandColor: '#F8FAFC',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
    showWatermark: false,
  },
  modern_minimal: {
    primaryColor: '#0F172A',
    secondaryColor: '#334155',
    darkColor: '#020617',
    grayColor: '#64748B',
    lightColor: '#E2E8F0',
    bandColor: '#F8FAFC',
    headerLayout: 'CLEAN_MINIMAL',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'REGULAR',
    logoSize: 'SMALL',
    logoScale: 60,
    showLogo: false,
    showSignature: false,
    showWatermark: false,
  },
  emerald_growth: {
    primaryColor: '#047857',
    secondaryColor: '#059669',
    darkColor: '#064E3B',
    grayColor: '#475569',
    lightColor: '#A7F3D0',
    bandColor: '#F0FDF4',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'STRIPED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'LARGE',
    logoScale: 135,
    showLogo: true,
    showSignature: false,
    showWatermark: false,
  },
  solar_amber: {
    primaryColor: '#D97706',
    secondaryColor: '#B45309',
    darkColor: '#1C1917',
    grayColor: '#78716C',
    lightColor: '#FDE68A',
    bandColor: '#FFFBEB',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'MINIMAL_DIVIDERS',
    fontFamily: 'Helvetica',
    fontWeight: 'EXTRA_BOLD',
    logoSize: 'LARGE',
    logoScale: 135,
    showLogo: true,
    showSignature: true,
    showWatermark: false,
  },
  retail_ruby: {
    primaryColor: '#BE123C',
    secondaryColor: '#E11D48',
    darkColor: '#18181B',
    grayColor: '#71717A',
    lightColor: '#FECDD3',
    bandColor: '#FFF1F2',
    headerLayout: 'CENTERED_BANNER',
    tableStyle: 'BORDERED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: false,
    showWatermark: false,
  },
  royal_indigo: {
    primaryColor: '#4338CA',
    secondaryColor: '#6366F1',
    darkColor: '#1E1B4B',
    grayColor: '#64748B',
    lightColor: '#C7D2FE',
    bandColor: '#EEF2FF',
    headerLayout: 'MODERN_SPLIT',
    tableStyle: 'STRIPED',
    fontFamily: 'Helvetica',
    fontWeight: 'BOLD',
    logoSize: 'MEDIUM',
    logoScale: 100,
    showLogo: true,
    showSignature: true,
    showWatermark: false,
  },
  luxury_gold: {
    primaryColor: '#B45309',
    secondaryColor: '#9A3412',
    darkColor: '#1C1917',
    grayColor: '#78716C',
    lightColor: '#FDE68A',
    bandColor: '#FEF3C7',
    headerLayout: 'CENTERED_BANNER',
    tableStyle: 'BORDERED',
    fontFamily: 'TimesRoman',
    fontWeight: 'BOLD',
    logoSize: 'LARGE',
    logoScale: 140,
    showLogo: true,
    showSignature: true,
    showWatermark: false,
  },
  classic_monochrome: {
    primaryColor: '#111827',
    secondaryColor: '#374151',
    darkColor: '#000000',
    grayColor: '#4B5563',
    lightColor: '#D1D5DB',
    bandColor: '#F3F4F6',
    headerLayout: 'CLEAN_MINIMAL',
    tableStyle: 'BORDERED',
    fontFamily: 'TimesRoman',
    fontWeight: 'REGULAR',
    logoSize: 'SMALL',
    logoScale: 60,
    showLogo: false,
    showSignature: true,
    showWatermark: false,
  },
};

function hexToRgb(hex = '#000000', fallback = rgb(0.1, 0.1, 0.1)) {
  try {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16) / 255;
      const g = parseInt(clean[1] + clean[1], 16) / 255;
      const b = parseInt(clean[2] + clean[2], 16) / 255;
      return isNaN(r) || isNaN(g) || isNaN(b) ? fallback : rgb(r, g, b);
    }
    if (clean.length === 6) {
      const r = parseInt(clean.substring(0, 2), 16) / 255;
      const g = parseInt(clean.substring(2, 4), 16) / 255;
      const b = parseInt(clean.substring(4, 6), 16) / 255;
      return isNaN(r) || isNaN(g) || isNaN(b) ? fallback : rgb(r, g, b);
    }
  } catch {}
  return fallback;
}

@Injectable()
export class InvoicePdfService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private async company() {
    const setting = await this.prisma.setting.findFirst({ where: { key: 'company' } });
    return (setting?.value as any) ?? { name: 'Business Store' };
  }

  /** Resolves tenant's active PDF theme configuration. */
  async getTheme(override?: Partial<PdfThemeConfig>): Promise<ResolvedPdfTheme> {
    const setting = await this.prisma.setting.findFirst({ where: { key: 'pdf_theme' } });
    const stored = (setting?.value as PdfThemeConfig) || {};

    const presetKey = override?.presetId || stored.presetId || 'classic_default';
    const preset = PDF_PRESETS[presetKey] || PDF_PRESETS.classic_default;

    const merged: PdfThemeConfig = {
      ...preset,
      ...stored,
      ...override,
    };

    const computedScale =
      typeof merged.logoScale === 'number' && !isNaN(merged.logoScale)
        ? merged.logoScale
        : merged.logoSize === 'SMALL'
          ? 60
          : merged.logoSize === 'LARGE'
            ? 135
            : merged.logoSize === 'XLARGE'
              ? 170
              : 100;

    return {
      primary: hexToRgb(merged.primaryColor, rgb(0.09, 0.09, 0.08)),
      secondary: hexToRgb(merged.secondaryColor, rgb(0.44, 0.44, 0.48)),
      dark: hexToRgb(merged.darkColor, rgb(0.09, 0.09, 0.08)),
      gray: hexToRgb(merged.grayColor, rgb(0.44, 0.44, 0.48)),
      light: hexToRgb(merged.lightColor, rgb(0.89, 0.89, 0.9)),
      band: hexToRgb(merged.bandColor, rgb(0.96, 0.96, 0.96)),
      headerLayout: merged.headerLayout || 'MODERN_SPLIT',
      tableStyle: merged.tableStyle || 'MINIMAL_DIVIDERS',
      fontFamily: merged.fontFamily || 'Helvetica',
      fontWeight: merged.fontWeight || 'BOLD',
      logoSize: merged.logoSize || 'MEDIUM',
      logoScale: computedScale,
      footerNote: merged.footerNote,
      showLogo: merged.showLogo !== false,
      showSignature: merged.showSignature === true,
      signatureTitle: merged.signatureTitle || 'Authorized Signature & Stamp',
      signatureSignerName: merged.signatureSignerName,
      showWatermark: merged.showWatermark,
      watermarkText: merged.watermarkText,
    };
  }

  private async embedFonts(pdf: PDFDocument, family: FontFamilyOption = 'Helvetica') {
    if (family === 'TimesRoman') {
      const font = await pdf.embedFont(StandardFonts.TimesRoman);
      const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
      return { font, bold };
    }
    if (family === 'Courier') {
      const font = await pdf.embedFont(StandardFonts.Courier);
      const bold = await pdf.embedFont(StandardFonts.CourierBold);
      return { font, bold };
    }
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return { font, bold };
  }

  private async embedLogo(pdf: PDFDocument, logoUrl?: string) {
    if (!logoUrl) return null;
    try {
      const bytes = await this.storage.get(`uploads/${basename(logoUrl)}`);
      if (!bytes) return null;
      const lower = logoUrl.toLowerCase();
      return lower.endsWith('.png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  private fmtDate(d: Date | string) {
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    return dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /** Draws background watermark if configured */
  private drawWatermark(page: PDFPage, font: PDFFont, text = 'ORIGINAL') {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - 120,
      y: height / 2 - 40,
      size: 54,
      font,
      color: rgb(0.88, 0.9, 0.93),
      rotate: degrees(45),
    });
  }

  /**
   * Universal header supporting multiple layout modes & logo scaling:
   */
  private async header(
    pdf: PDFDocument,
    page: PDFPage,
    fonts: { font: PDFFont; bold: PDFFont },
    title: string,
    company: any,
    theme: ResolvedPdfTheme,
  ) {
    const { font, bold } = fonts;
    const width = page.getWidth();

    if (theme.showWatermark && theme.watermarkText) {
      this.drawWatermark(page, bold, theme.watermarkText);
    }

    const infoLines = [company.name, company.address, company.phone, company.email].filter(Boolean).map(String);
    const logo = theme.showLogo ? await this.embedLogo(pdf, company.logoUrl) : null;

    // Logo size dimensions based on user scale percentage (up to 250%)
    const scaleFactor = Math.max(0.3, Math.min(2.5, (theme.logoScale || 100) / 100));
    const maxW = 240 * scaleFactor;
    const maxH = 90 * scaleFactor;

    const scale = logo ? Math.min(maxW / logo.width, maxH / logo.height) : 0;
    const w = logo ? logo.width * scale : 0;
    const h = logo ? logo.height * scale : 0;

    // Layout: CLEAN_MINIMAL
    if (theme.headerLayout === 'CLEAN_MINIMAL') {
      // Top colored bar
      page.drawRectangle({ x: 0, y: 834, width, height: 8, color: theme.primary });
      
      let curY = 780;
      if (logo) {
        page.drawImage(logo, { x: 40, y: curY - h + 10, width: w, height: h });
        curY -= h + 2;
      }
      
      const companyTitle = company.name ?? 'Business Store';
      page.drawText(companyTitle, { x: 40, y: curY, size: 15, font: bold, color: theme.primary });
      curY -= 14;

      const subtitle = [company.address, company.phone, company.email].filter(Boolean).join(' · ');
      if (subtitle) {
        page.drawText(subtitle.length > 75 ? subtitle.slice(0, 75) + '…' : subtitle, {
          x: 40,
          y: curY,
          size: 9,
          font,
          color: theme.gray,
        });
        curY -= 14;
      }

      // Title on right
      const titleW = bold.widthOfTextAtSize(title.toUpperCase(), 18);
      page.drawText(title.toUpperCase(), { x: width - 40 - titleW, y: 778, size: 18, font: bold, color: theme.dark });

      page.drawLine({ start: { x: 40, y: Math.min(742, curY) }, end: { x: width - 40, y: Math.min(742, curY) }, thickness: 1, color: theme.light });
      return Math.min(720, curY - 16);
    }

    // Layout: CENTERED_BANNER
    if (theme.headerLayout === 'CENTERED_BANNER') {
      let curY = 800;
      if (logo) {
        page.drawImage(logo, { x: (width - w) / 2, y: curY - h, width: w, height: h });
        curY -= h + 10;
      } else {
        const name = company.name ?? 'Business Store';
        const nw = bold.widthOfTextAtSize(name, 20);
        page.drawText(name, { x: (width - nw) / 2, y: curY - 20, size: 20, font: bold, color: theme.primary });
        curY -= 32;
      }

      const infoStr = [company.address, company.phone, company.email].filter(Boolean).join(' | ');
      if (infoStr) {
        const iw = font.widthOfTextAtSize(infoStr, 8.5);
        page.drawText(infoStr.length > 90 ? infoStr.slice(0, 90) + '…' : infoStr, {
          x: Math.max(30, (width - iw) / 2),
          y: curY,
          size: 8.5,
          font,
          color: theme.gray,
        });
        curY -= 16;
      }

      // Center Title Banner
      const tw = bold.widthOfTextAtSize(title.toUpperCase(), 15);
      page.drawRectangle({ x: (width - tw - 40) / 2, y: curY - 20, width: tw + 40, height: 24, color: theme.band, borderColor: theme.primary, borderWidth: 1 });
      page.drawText(title.toUpperCase(), { x: (width - tw) / 2, y: curY - 13, size: 13, font: bold, color: theme.primary });
      
      return curY - 38;
    }

    // Layout: MODERN_SPLIT (Default)
    const right = (str: string, y: number, size: number, f: PDFFont, color = theme.gray) =>
      page.drawText(str, { x: width - 50 - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let titleY = 762;
    let logoBottom = 786;
    if (logo) {
      logoBottom = 806 - h;
      page.drawImage(logo, { x: 50, y: logoBottom, width: w, height: h });
    } else {
      page.drawText(company.name ?? 'Business Store', { x: 50, y: 760, size: 18, font: bold, color: theme.primary });
    }

    right(title, titleY, 24, bold, theme.dark);
    let hy = titleY - 20;
    for (const line of infoLines) {
      right(line, hy, 9.5, font, theme.gray);
      hy -= 14;
    }

    return Math.min(700, hy - 8, logo ? logoBottom - 16 : 700);
  }

  /** Info band with customizable brand accent and theme background. */
  private band(
    page: PDFPage,
    fonts: { font: PDFFont; bold: PDFFont },
    yTop: number,
    left: { label: string; rows: { text: string; bold?: boolean; size?: number }[] },
    rightRows: { label: string; value: string }[],
    rightLabel: string,
    theme: ResolvedPdfTheme,
  ) {
    const { font, bold } = fonts;
    const width = page.getWidth();
    const height = 30 + Math.max(left.rows.length, rightRows.length) * 18 + 14;
    
    // Background
    page.drawRectangle({ x: 35, y: yTop - height, width: width - 70, height, color: theme.band, borderColor: theme.light, borderWidth: 0.5 });
    // Left brand accent bar
    page.drawRectangle({ x: 35, y: yTop - height, width: 4, height, color: theme.primary });

    let y = yTop - 22;
    page.drawText(left.label.toUpperCase(), { x: 50, y, size: 8.5, font: bold, color: theme.primary });
    const rightAt = (str: string, ry: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: width - 50 - f.widthOfTextAtSize(str, size), y: ry, size, font: f, color });
    rightAt(rightLabel.toUpperCase(), y, 8.5, bold, theme.secondary);

    y -= 18;
    let ly = y;
    for (const row of left.rows) {
      page.drawText(row.text, { x: 50, y: ly, size: row.size ?? 10.5, font: row.bold ? bold : font, color: theme.dark });
      ly -= 18;
    }
    let ry = y;
    for (const row of rightRows) {
      const valueW = bold.widthOfTextAtSize(row.value, 10.5);
      rightAt(row.value, ry, 10.5, bold, theme.dark);
      page.drawText(row.label, {
        x: page.getWidth() - 50 - valueW - 8 - font.widthOfTextAtSize(row.label, 9.5),
        y: ry,
        size: 9.5,
        font,
        color: theme.gray,
      });
      ry -= 18;
    }
    return yTop - height - 20;
  }

  private footer(page: PDFPage, fonts: { font: PDFFont; bold: PDFFont }, company: any, defaultThanks: string, theme: ResolvedPdfTheme) {
    const { font, bold } = fonts;
    const width = page.getWidth();

    // Signature Block if enabled
    if (theme.showSignature) {
      const sigW = 170;
      const sigX = width - 40 - sigW;
      const sigY = 120;

      // Draw stylized signature text above line
      if (theme.signatureSignerName) {
        page.drawText(theme.signatureSignerName, {
          x: sigX + 8,
          y: sigY + 5,
          size: 12,
          font: bold,
          color: theme.primary,
        });
      }

      page.drawLine({ start: { x: sigX, y: sigY }, end: { x: width - 40, y: sigY }, thickness: 0.75, color: theme.dark });
      page.drawText(theme.signatureTitle || 'Authorized Signature & Stamp', {
        x: sigX,
        y: sigY - 12,
        size: 8.5,
        font: bold,
        color: theme.dark,
      });
      if (theme.signatureSignerName) {
        page.drawText(theme.signatureSignerName, {
          x: sigX,
          y: sigY - 23,
          size: 8,
          font,
          color: theme.gray,
        });
      }
    }

    page.drawLine({ start: { x: 35, y: 80 }, end: { x: width - 35, y: 80 }, thickness: 0.5, color: theme.light });
    
    const note = theme.footerNote || defaultThanks;
    const noteLines = note.split('\n').slice(0, 2);
    let ny = 66;
    for (const nl of noteLines) {
      page.drawText(nl.length > 85 ? nl.slice(0, 85) + '…' : nl, { x: 35, y: ny, size: 8, font, color: theme.gray });
      ny -= 11;
    }

    const name = company.name ?? 'Business Store';
    page.drawText(name, { x: width - 35 - bold.widthOfTextAtSize(name, 10), y: 56, size: 10, font: bold, color: theme.dark });
    const date = this.fmtDate(new Date());
    page.drawText(date, { x: width - 35 - font.widthOfTextAtSize(date, 8), y: 44, size: 8, font, color: theme.gray });
  }

  /**
   * Generates Invoice PDF styled with tenant's dynamic theme
   */
  async generate(invoiceId: string, themeOverride?: Partial<PdfThemeConfig>): Promise<Uint8Array> {
    const inv = await this.prisma.invoice.findUnique({
      relationLoadStrategy: 'join',
      where: { id: invoiceId },
      include: {
        client: { include: { addresses: true } },
        supplier: true,
        salesOrder: { select: { number: true } },
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
    const theme = await this.getTheme(themeOverride);

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const fonts = await this.embedFonts(pdf, theme.fontFamily);
    const { font, bold } = fonts;
    const width = page.getWidth();
    
    const money = (n: any) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const qty = (n: any) => {
      const v = Number(n);
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3)));
    };
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, inv.type === 'SALE' ? 'Tax Invoice' : 'Purchase Invoice', company, theme);

    const party = inv.type === 'SALE' ? inv.client : inv.supplier;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party && 'phone' in party && party.phone) partyRows.push({ text: party.phone });

    y = this.band(
      page,
      fonts,
      y,
      { label: inv.type === 'SALE' ? 'Billed to' : 'Supplier info', rows: partyRows },
      [
        { label: 'Invoice #', value: inv.number.replace(/^\D+/, '') || inv.number },
        { label: 'Issue Date', value: this.fmtDate(inv.issueDate) },
        { label: 'Due Date', value: inv.dueDate ? this.fmtDate(inv.dueDate) : 'Upon Receipt' },
      ],
      'Invoice Details',
      theme,
    );

    // Table Header
    const colQty = 340;
    const colPrice = 440;
    const colAmount = width - 40;

    if (theme.tableStyle === 'STRIPED' || theme.tableStyle === 'BORDERED') {
      page.drawRectangle({ x: 35, y: y - 20, width: width - 70, height: 22, color: theme.band });
    }
    
    page.drawLine({ start: { x: 35, y: y + 2 }, end: { x: width - 35, y: y + 2 }, thickness: 1, color: theme.primary });
    y -= 14;
    page.drawText('Description / Items', { x: 45, y, size: 9.5, font: bold, color: theme.primary });
    rightAt('Qty', colQty, y, 9.5, bold, theme.primary);
    rightAt('Unit Price', colPrice, y, 9.5, bold, theme.primary);
    rightAt('Line Total', colAmount, y, 9.5, bold, theme.primary);
    y -= 8;
    page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: theme.light });
    y -= 18;

    let rowIndex = 0;
    for (const item of inv.items) {
      if (y < 160) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }

      if (theme.tableStyle === 'STRIPED' && rowIndex % 2 === 1) {
        page.drawRectangle({ x: 35, y: y - 8, width: width - 70, height: 20, color: theme.band });
      }

      const name = item.product?.name || item.description;
      const desc = name.length > 50 ? name.slice(0, 50) + '…' : name;
      page.drawText(desc, { x: 45, y, size: 10, font, color: theme.dark });
      rightAt(qty(item.quantity), colQty, y, 10, font, theme.dark);
      rightAt(money(item.unitPrice), colPrice, y, 10, font, theme.dark);
      rightAt(money(item.lineTotal), colAmount, y, 10, bold, theme.dark);
      y -= 10;

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
            x: 55, y, size: 8.5, font, color: theme.gray,
          });
          y -= 12;
        }
        y -= 4;
      }

      if (theme.tableStyle === 'BORDERED') {
        page.drawLine({ start: { x: 35, y: y + 2 }, end: { x: width - 35, y: y + 2 }, thickness: 0.5, color: theme.light });
      } else {
        page.drawLine({ start: { x: 45, y: y + 2 }, end: { x: width - 45, y: y + 2 }, thickness: 0.5, color: theme.light });
      }
      y -= 16;
      rowIndex++;
    }

    // Totals Box
    if (y < 220) {
      page = pdf.addPage([595, 842]);
      y = 780;
    }
    
    y -= 6;
    const totalRow = (label: string, value: string, isBold = false, size = 10, isHighlight = false) => {
      rightAt(label, colPrice, y, size, isBold ? bold : font, isHighlight ? theme.primary : isBold ? theme.dark : theme.gray);
      rightAt(value, colAmount, y, size, bold, isHighlight ? theme.primary : theme.dark);
      y -= 6;
      page.drawLine({ start: { x: colQty - 20, y }, end: { x: width - 35, y }, thickness: isHighlight ? 1 : 0.5, color: isHighlight ? theme.primary : theme.light });
      y -= 16;
    };

    totalRow('Subtotal', money(inv.subtotal));
    if (inv.discountType && Number(inv.discountValue) > 0) {
      const d = inv.discountType === 'PERCENT' ? `${Number(inv.discountValue)}%` : money(inv.discountValue);
      totalRow(`Discount (${d})`, '');
    }
    if (Number(inv.shippingFee) > 0) totalRow('Shipping & Delivery', money(inv.shippingFee));
    totalRow('Total Amount', money(inv.total), true, 12, true);
    if (Number(inv.paidAmount) > 0) {
      totalRow('Amount Paid', money(inv.paidAmount));
      totalRow('Balance Due', money(Number(inv.total) - Number(inv.paidAmount)), true, 11);
    }

    this.footer(
      page,
      fonts,
      company,
      `Thank you for your business with ${company.name ?? 'us'}. Payment is due per agreed terms.`,
      theme,
    );

    return pdf.save();
  }

  /** Universal Payment Receipt */
  async receipt(paymentId: string, themeOverride?: Partial<PdfThemeConfig>): Promise<Uint8Array> {
    const p = await this.prisma.payment.findUnique({
      relationLoadStrategy: 'join',
      where: { id: paymentId },
      include: {
        client: true,
        supplier: true,
        invoice: { select: { number: true, total: true, paidAmount: true } },
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const company = await this.company();
    const theme = await this.getTheme(themeOverride);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const fonts = await this.embedFonts(pdf, theme.fontFamily);
    const { font, bold } = fonts;
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Official Receipt', company, theme);

    const party = p.client ?? p.supplier;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party?.phone) partyRows.push({ text: party.phone });

    y = this.band(
      page,
      fonts,
      y,
      { label: p.direction === 'INCOMING' ? 'Received from' : 'Paid to', rows: partyRows },
      [
        { label: 'Receipt #', value: p.number },
        { label: 'Date', value: this.fmtDate(p.paymentDate) },
        { label: 'Method', value: p.method },
        ...(p.reference ? [{ label: 'Reference #', value: p.reference }] : []),
      ],
      'Payment Information',
      theme,
    );

    // Callout Box for Amount Received
    y -= 10;
    const calloutH = 60;
    page.drawRectangle({
      x: 35,
      y: y - calloutH,
      width: width - 70,
      height: calloutH,
      color: theme.band,
      borderColor: theme.primary,
      borderWidth: 1,
    });

    page.drawText('AMOUNT RECEIVED', { x: 55, y: y - 22, size: 9, font: bold, color: theme.secondary });
    page.drawText(money(p.amount), { x: 55, y: y - 48, size: 20, font: bold, color: theme.primary });
    
    if (p.invoice) {
      rightAt(`Applied to Invoice #${p.invoice.number}`, width - 55, y - 26, 10, font, theme.gray);
      rightAt(`Invoice Total: ${money(p.invoice.total)}`, width - 55, y - 46, 10, bold, theme.dark);
    }

    y -= calloutH + 40;

    if (p.notes) {
      page.drawText('Notes:', { x: 45, y, size: 10, font: bold, color: theme.dark });
      y -= 16;
      page.drawText(p.notes, { x: 45, y, size: 9.5, font, color: theme.gray });
      y -= 24;
    }

    this.footer(
      page,
      fonts,
      company,
      `Official receipt generated by ${company.name ?? 'our company'}. Keep for your financial records.`,
      theme,
    );

    return pdf.save();
  }

  /** Universal Quotation / Estimate PDF */
  async quotation(quotationId: string, themeOverride?: Partial<PdfThemeConfig>): Promise<Uint8Array> {
    const q = await this.prisma.quotation.findUnique({
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
    const theme = await this.getTheme(themeOverride);

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const fonts = await this.embedFonts(pdf, theme.fontFamily);
    const { font, bold } = fonts;
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const qty = (n: any) => {
      const v = Number(n);
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(3)));
    };
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Price Quotation', company, theme);

    const party = q.client;
    const partyRows: { text: string; bold?: boolean }[] = [{ text: party?.name ?? '—', bold: true }];
    if (party?.phone) partyRows.push({ text: party.phone });
    if (party?.email) partyRows.push({ text: party.email });

    y = this.band(
      page,
      fonts,
      y,
      { label: 'Prepared for', rows: partyRows },
      [
        { label: 'Quote #', value: q.number },
        { label: 'Date', value: this.fmtDate(q.createdAt) },
        { label: 'Valid until', value: q.validUntil ? this.fmtDate(q.validUntil) : '30 Days' },
      ],
      'Proposal Details',
      theme,
    );

    // Table Header
    const colQty = 340;
    const colPrice = 440;
    const colAmount = width - 40;

    page.drawLine({ start: { x: 35, y: y + 2 }, end: { x: width - 35, y: y + 2 }, thickness: 1, color: theme.primary });
    y -= 14;
    page.drawText('Description / Proposal Item', { x: 45, y, size: 9.5, font: bold, color: theme.primary });
    rightAt('Qty', colQty, y, 9.5, bold, theme.primary);
    rightAt('Unit Price', colPrice, y, 9.5, bold, theme.primary);
    rightAt('Line Total', colAmount, y, 9.5, bold, theme.primary);
    y -= 8;
    page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: theme.light });
    y -= 18;

    for (const item of q.items) {
      if (y < 160) {
        page = pdf.addPage([595, 842]);
        y = 780;
      }

      const name = item.product?.name || item.description || 'Custom Item';
      const desc = name.length > 50 ? name.slice(0, 50) + '…' : name;
      page.drawText(desc, { x: 45, y, size: 10, font, color: theme.dark });
      rightAt(qty(item.quantity), colQty, y, 10, font, theme.dark);
      rightAt(money(item.unitPrice), colPrice, y, 10, font, theme.dark);
      rightAt(money(item.lineTotal), colAmount, y, 10, bold, theme.dark);
      y -= 14;

      page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 0.5, color: theme.light });
      y -= 16;
    }

    // Totals
    y -= 6;
    const totalRow = (label: string, value: string, isBold = false, size = 10, isHighlight = false) => {
      rightAt(label, colPrice, y, size, isBold ? bold : font, isHighlight ? theme.primary : isBold ? theme.dark : theme.gray);
      rightAt(value, colAmount, y, size, bold, isHighlight ? theme.primary : theme.dark);
      y -= 6;
      page.drawLine({ start: { x: colQty - 20, y }, end: { x: width - 35, y }, thickness: isHighlight ? 1 : 0.5, color: isHighlight ? theme.primary : theme.light });
      y -= 16;
    };

    totalRow('Estimated Subtotal', money(q.subtotal));
    if (q.discountType && Number(q.discountValue) > 0) {
      const d = q.discountType === 'PERCENT' ? `${Number(q.discountValue)}%` : money(q.discountValue);
      totalRow(`Discount (${d})`, '');
    }
    totalRow('Total Estimated Quote', money(q.total), true, 12, true);

    if (q.notes) {
      y -= 8;
      page.drawText('Terms & Conditions:', { x: 45, y, size: 9.5, font: bold, color: theme.dark });
      y -= 14;
      for (const line of q.notes.split('\n').slice(0, 3)) {
        page.drawText(line.length > 80 ? line.slice(0, 80) + '…' : line, { x: 45, y, size: 8.5, font, color: theme.gray });
        y -= 12;
      }
    }

    this.footer(
      page,
      fonts,
      company,
      `Quotation valid until ${q.validUntil ? this.fmtDate(q.validUntil) : '30 days from issuance'}.`,
      theme,
    );

    return pdf.save();
  }

  /** Aggregates client statement data */
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
        amount: Number(p.amount),
        currency: p.currency,
      }));

      return {
        client,
        mode: 'PAYMENTS' as const,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
        entries,
        totalPaymentsCount: entries.length,
        totalAmountPaid: entries.reduce((s, e) => s + e.amount, 0),
      };
    }

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          clientId,
          type: 'SALE',
          deletedAt: null,
          ...(startDate && { issueDate: { gte: startDate } }),
          ...(endDate && { issueDate: { lte: endDate } }),
        },
        select: { id: true, number: true, issueDate: true, total: true },
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
        select: { id: true, number: true, paymentDate: true, amount: true, invoice: { select: { number: true } } },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const raw: any[] = [
      ...invoices.map((inv) => ({
        type: 'INVOICE',
        ref: inv.number,
        date: inv.issueDate,
        debit: Number(inv.total),
        credit: 0,
      })),
      ...payments.map((p) => ({
        type: 'PAYMENT',
        ref: p.number,
        invoiceNumber: p.invoice?.number,
        date: p.paymentDate,
        debit: 0,
        credit: Number(p.amount),
      })),
    ];

    raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let current = 0;
    const entries = raw.map((r) => {
      current = current + r.debit - r.credit;
      return { ...r, runningBalance: current };
    });

    return {
      client,
      mode: 'FULL' as const,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
      openingBalance: 0,
      entries,
      totalBilled: entries.reduce((s, e) => s + e.debit, 0),
      totalPaid: entries.reduce((s, e) => s + e.credit, 0),
      closingBalance: current,
    };
  }

  /** Generates Statement of Account PDF */
  async clientStatement(
    clientId: string,
    options: { mode?: 'FULL' | 'PAYMENTS'; startDate?: Date; endDate?: Date } = {},
    themeOverride?: Partial<PdfThemeConfig>,
  ): Promise<Uint8Array> {
    const data = await this.getClientStatementData(clientId, options);
    const company = await this.company();
    const theme = await this.getTheme(themeOverride);

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([595, 842]);
    const fonts = await this.embedFonts(pdf, theme.fontFamily);
    const { font, bold } = fonts;
    const width = page.getWidth();
    const money = (n: any) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Statement of Account', company, theme);

    const client = data.client;
    y = this.band(
      page,
      fonts,
      y,
      { label: 'Client / Account', rows: [{ text: client.name, bold: true }, ...(client.phone ? [{ text: client.phone }] : [])] },
      [
        { label: 'Date', value: this.fmtDate(new Date()) },
        { label: 'Total Invoiced', value: money(data.totalBilled) },
        { label: 'Total Paid', value: money(data.totalPaid) },
        { label: 'Outstanding Balance', value: money(data.closingBalance) },
      ],
      'Account Summary',
      theme,
    );

    this.footer(
      page,
      fonts,
      company,
      `For billing or statement inquiries, please contact ${company.email || company.phone || company.name}.`,
      theme,
    );

    return pdf.save();
  }

  /**
   * Generates a Universal Live Sample PDF for real-time previewing in Theme Studio
   */
  async samplePdf(themeOverride?: Partial<PdfThemeConfig>): Promise<Uint8Array> {
    const company = await this.company();
    const theme = await this.getTheme(themeOverride);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const fonts = await this.embedFonts(pdf, theme.fontFamily);
    const { font, bold } = fonts;
    const width = page.getWidth();

    const money = (n: any) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rightAt = (str: string, x: number, y: number, size: number, f: PDFFont, color = theme.dark) =>
      page.drawText(str, { x: x - f.widthOfTextAtSize(str, size), y, size, font: f, color });

    let y = await this.header(pdf, page, fonts, 'Invoice', company, theme);

    y = this.band(
      page,
      fonts,
      y,
      {
        label: 'Bill to',
        rows: [
          { text: 'Client / Company Name', bold: true },
          { text: '+1 (555) 019-2834' },
        ],
      },
      [
        { label: 'Invoice #', value: '00014' },
        { label: 'Date', value: this.fmtDate(new Date()) },
      ],
      'Bill info',
      theme,
    );

    // Table Header
    const colQty = 340;
    const colPrice = 440;
    const colAmount = width - 40;

    if (theme.tableStyle === 'STRIPED' || theme.tableStyle === 'BORDERED') {
      page.drawRectangle({ x: 35, y: y - 20, width: width - 70, height: 22, color: theme.band });
    }

    page.drawLine({ start: { x: 35, y: y + 2 }, end: { x: width - 35, y: y + 2 }, thickness: 1, color: theme.primary });
    y -= 14;
    page.drawText('Item', { x: 45, y, size: 9.5, font: bold, color: theme.primary });
    rightAt('Quantity', colQty, y, 9.5, bold, theme.primary);
    rightAt('Price', colPrice, y, 9.5, bold, theme.primary);
    rightAt('Amount', colAmount, y, 9.5, bold, theme.primary);
    y -= 8;
    page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 0.5, color: theme.light });
    y -= 18;

    const sampleItems = [
      { name: 'Commercial Equipment / Service Package', qty: 1, price: 725, total: 725 },
    ];

    let rowIdx = 0;
    for (const item of sampleItems) {
      if (theme.tableStyle === 'STRIPED' && rowIdx % 2 === 1) {
        page.drawRectangle({ x: 35, y: y - 8, width: width - 70, height: 20, color: theme.band });
      }

      page.drawText(item.name, { x: 45, y, size: 9.5, font, color: theme.dark });
      rightAt(String(item.qty), colQty, y, 9.5, font, theme.dark);
      rightAt(money(item.price), colPrice, y, 9.5, font, theme.dark);
      rightAt(money(item.total), colAmount, y, 9.5, bold, theme.dark);
      y -= 10;

      page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 0.5, color: theme.light });
      y -= 16;
      rowIdx++;
    }

    // Totals Box
    y -= 6;
    const totalRow = (label: string, value: string, isBold = false, size = 10, isHighlight = false) => {
      rightAt(label, colPrice, y, size, isBold ? bold : font, isHighlight ? theme.primary : isBold ? theme.dark : theme.gray);
      rightAt(value, colAmount, y, size, bold, isHighlight ? theme.primary : theme.dark);
      y -= 6;
      page.drawLine({ start: { x: colQty - 20, y }, end: { x: width - 35, y }, thickness: isHighlight ? 1 : 0.5, color: isHighlight ? theme.primary : theme.light });
      y -= 16;
    };

    totalRow('Subtotal', money(725));
    totalRow('Total', money(725), true, 11, false);
    totalRow('Paid', money(725));
    totalRow('Balance due', money(0), true, 11, false);

    this.footer(
      page,
      fonts,
      company,
      `Thank you for choosing ${company.name ?? 'us'}. We appreciate your business and look forward to serving you again.`,
      theme,
    );

    return pdf.save();
  }
}
