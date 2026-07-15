import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';

type Row = Record<string, unknown>;

@Injectable()
export class ExportService {
  constructor(private reports: ReportsService) {}

  /** Resolve a report name to flat rows suitable for tabular export. */
  private async rows(report: string, from?: string, to?: string): Promise<Row[]> {
    switch (report) {
      case 'inventory-valuation':
        return (await this.reports.inventoryValuation()).rows;
      case 'receivables':
        return this.reports.receivables();
      case 'payables':
        return this.reports.payables();
      case 'profit-by-product':
        return this.reports.profitByProduct(from, to);
      case 'cash-flow':
        return (await this.reports.cashFlow(from, to)).days;
      case 'reorder':
        return this.reports.reorderSuggestions();
      default:
        throw new BadRequestException(
          'Unknown report — use one of: inventory-valuation, receivables, payables, profit-by-product, cash-flow, reorder',
        );
    }
  }

  private flatten(rows: Row[]): { headers: string[]; data: unknown[][] } {
    if (!rows.length) return { headers: [], data: [] };
    const headers = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object' || rows[0][k] === null || rows[0][k] instanceof Date);
    const data = rows.map((r) => headers.map((h) => (r[h] instanceof Date ? (r[h] as Date).toISOString().slice(0, 10) : (r[h] ?? ''))));
    return { headers, data };
  }

  async toCsv(report: string, from?: string, to?: string): Promise<string> {
    const { headers, data } = this.flatten(await this.rows(report, from, to));
    const escape = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...data.map((row) => row.map(escape).join(','))].join('\r\n');
  }

  async toXlsx(report: string, from?: string, to?: string): Promise<Buffer> {
    const { headers, data } = this.flatten(await this.rows(report, from, to));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.slice(0, 31));
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    data.forEach((row) => ws.addRow(row));
    (ws.columns ?? []).forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        max = Math.max(max, String(cell.value ?? '').length + 2);
      });
      col.width = Math.min(max, 40);
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
