import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InvoicePdfService } from '../invoices/invoice-pdf.service';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { SalesOrdersService } from './sales-orders.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { LineItemDto } from '../common/line-item.dto';

class VerifyTokenDto {
  @IsString()
  @MinLength(10)
  token: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ClaimDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

class SalesOrderDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  quotationId?: string;

  @IsString()
  warehouseId: string;

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

  /** Itemise bundle contents on the customer's invoice. Off by default. */
  @IsOptional()
  @IsBoolean()
  showSubItemsOnInvoice?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  items: LineItemDto[];
}

class UpdateSalesOrderDto extends SalesOrderDto {
  @IsOptional()
  @IsString()
  declare clientId: string;

  @IsOptional()
  @IsString()
  declare warehouseId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  declare items: LineItemDto[];
}

class SerialAssignmentDto {
  @IsString()
  productId: string;

  @IsArray()
  serialNumbers: string[];
}

class ConfirmDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SerialAssignmentDto)
  serialAssignments?: SerialAssignmentDto[];
}

class DeliveryLineDto {
  @IsString()
  itemId: string;

  @IsInt()
  quantity: number;
}

class DeliverDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  deliveries: DeliveryLineDto[];
}

class PayDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['CASH', 'WHISH', 'OMT', 'STORE_CREDIT'])
  method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  paymentDate?: string;
}

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private service: SalesOrdersService,
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

  /** Can this order be deleted outright, or only archived? */
  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.service.usage(id);
  }

  /** Only a cancelled order can be removed; see the service for purge vs archive. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  /** Bring an archived order back into the active list. */
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restore(user.id, id);
  }

  /** Receipt printing: mint the signed token that goes inside the QR. */
  @Get(':id/pickup-token')
  pickupToken(@Param('id') id: string) {
    return this.service.issuePickupToken(id);
  }

  /**
   * Warehouse scanner: check a scanned QR.
   *
   * POST rather than GET because a signed token is long and would otherwise sit
   * in server logs and browser history as a URL.
   */
  @Post('pickup/verify')
  verifyPickup(@Body() dto: VerifyTokenDto) {
    return this.service.verifyPickupToken(dto.token);
  }

  /** Warehouse scanner: release the goods against a verified QR. */
  @Post('pickup/claim-token')
  claimByToken(@CurrentUser() user: AuthUser, @Body() dto: VerifyTokenDto) {
    return this.service.claimByToken(user.id, dto.token, dto.notes);
  }

  /** Warehouse: look up an order from the code on a customer's receipt. */
  @Get('pickup/:code')
  byPickupCode(@Param('code') code: string) {
    return this.service.findByPickupCode(code);
  }

  /** Warehouse: release the goods against a verified receipt. */
  @Post('pickup/:code/claim')
  claim(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() dto: ClaimDto) {
    return this.service.claim(user.id, code, dto.notes);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SalesOrderDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmDto) {
    return this.service.confirm(user.id, id, dto.serialAssignments);
  }

  /**
   * Replace this order's invoice with one matching what the order now says.
   * For orders edited before editing re-issued automatically, whose invoice —
   * and therefore every report built from it — still describes the old sale.
   */
  @Post(':id/reissue-invoice')
  reissueInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reissueInvoice(user.id, id);
  }

  /**
   * Record which units went out on an order already confirmed. Moves no stock —
   * that happened at confirmation — it names the units that were not named then.
   */
  @Post(':id/serials')
  assignSerials(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmDto) {
    return this.service.assignSerials(user.id, id, dto.serialAssignments ?? []);
  }

  @Post(':id/deliver')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeliverDto) {
    return this.service.deliver(user.id, id, dto.deliveries);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }

  @Post(':id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PayDto) {
    return this.service.pay(user.id, id, dto);
  }

  @Get(':id/invoice-pdf')
  @Header('Content-Type', 'application/pdf')
  async invoicePdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const invoiceId = await this.service.ensureInvoice(user.id, id);
    const bytes = await this.pdfService.generate(invoiceId);
    res.setHeader('Content-Disposition', `inline; filename=invoice-${id}.pdf`);
    res.send(Buffer.from(bytes));
  }
}
