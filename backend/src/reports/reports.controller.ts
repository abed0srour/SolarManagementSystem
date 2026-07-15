import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ExportService } from './export.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private service: ReportsService,
    private exporter: ExportService,
  ) {}

  @Get(':report/export')
  async export(
    @Param('report') report: string,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (format === 'xlsx') {
      const buf = await this.exporter.toXlsx(report, from, to);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${report}.xlsx`);
      res.send(buf);
    } else {
      const csv = await this.exporter.toCsv(report, from, to);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=${report}.csv`);
      res.send('﻿' + csv);
    }
  }

  @Get('dashboard')
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.dashboard(from, to);
  }

  @Get('profit-by-product')
  profit(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.profitByProduct(from, to);
  }

  @Get('inventory-valuation')
  valuation() {
    return this.service.inventoryValuation();
  }

  @Get('receivables')
  receivables() {
    return this.service.receivables();
  }

  @Get('payables')
  payables() {
    return this.service.payables();
  }

  @Get('cash-flow')
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.cashFlow(from, to);
  }

  @Get('warranty')
  warranty() {
    return this.service.warrantyReport();
  }

  @Get('reorder')
  reorder() {
    return this.service.reorderSuggestions();
  }
}
