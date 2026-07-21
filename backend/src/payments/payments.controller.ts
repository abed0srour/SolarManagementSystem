import { Body, Controller, Delete, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentsService } from './payments.service';
import { InvoicePdfService } from '../invoices/invoice-pdf.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class PaymentDto {
  @IsIn(['INCOMING', 'OUTGOING'])
  direction: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  scheduleId?: string;

  @IsIn(['CASH', 'WHISH', 'OMT', 'STORE_CREDIT'])
  method: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private service: PaymentsService,
    private pdfService: InvoicePdfService,
  ) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('due-schedules')
  dueSchedules() {
    return this.service.dueSchedules();
  }

  @Get(':id/receipt-pdf')
  @Header('Content-Type', 'application/pdf')
  async receiptPdf(@Param('id') id: string, @Res() res: Response) {
    const bytes = await this.pdfService.receipt(id);
    res.setHeader('Content-Disposition', `inline; filename=receipt-${id}.pdf`);
    res.send(Buffer.from(bytes));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: PaymentDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
