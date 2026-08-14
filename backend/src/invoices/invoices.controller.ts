import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { LineItemDto } from '../common/line-item.dto';

/**
 * Invoice lines are ordinary document lines — bundles, metered quantities and
 * catalogue-derived prices included — plus the serial numbers that attach
 * physical units to the sale.
 */
class InvoiceItemDto extends LineItemDto {
  /** Units sold on this line; linking them starts their warranty clock. */
  @IsOptional()
  @IsArray()
  serialNumbers?: string[];
}

class InvoiceDto {
  @IsOptional()
  @IsIn(['SALE', 'PURCHASE'])
  type?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: string;

  @IsOptional()
  @IsNumber()
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  shippingFee?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}

class FromOrderDto {
  @IsString()
  salesOrderId: string;

  @IsOptional()
  @IsNumber()
  percent?: number;

  @IsOptional()
  @IsString()
  dueDate?: string;
}

class InstallmentDto {
  @IsString()
  dueDate: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

class ScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments: InstallmentDto[];
}

@Controller('invoices')
export class InvoicesController {
  constructor(
    private service: InvoicesService,
    private pdfService: InvoicePdfService,
  ) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const bytes = await this.pdfService.generate(id);
    res.setHeader('Content-Disposition', `inline; filename=invoice-${id}.pdf`);
    res.send(Buffer.from(bytes));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: InvoiceDto) {
    return this.service.create(user.id, dto);
  }

  @Post('from-order')
  fromOrder(@CurrentUser() user: AuthUser, @Body() dto: FromOrderDto) {
    return this.service.fromSalesOrder(user.id, dto.salesOrderId, dto);
  }

  @Post(':id/schedule')
  schedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ScheduleDto) {
    return this.service.setSchedule(user.id, id, dto.installments);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }
}
