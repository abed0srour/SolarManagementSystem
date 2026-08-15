import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PurchaseReturnsService } from './purchase-returns.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ReturnLineDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Defaults to the PO's unit cost for this product. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsString()
  reason?: string;
}

class CreatePurchaseReturnDto {
  @IsString()
  purchaseOrderId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];

  @IsOptional()
  @IsIn(['CASH', 'WHISH', 'OMT', 'CREDIT_NOTE'])
  refundMethod?: any;

  @IsOptional()
  @IsString()
  creditNoteRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  refundDate?: string;
}

class ReturnStatusDto {
  @IsIn(['PENDING', 'SENT', 'CREDITED', 'REPLACED', 'CLOSED'])
  status: string;

  @IsOptional()
  @IsString()
  creditNoteRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('purchase-returns')
export class PurchaseReturnsController {
  constructor(private service: PurchaseReturnsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  /** What is still returnable on a purchase order, with its in-stock serials. */
  @Get('returnable/:purchaseOrderId')
  returnable(@Param('purchaseOrderId') purchaseOrderId: string) {
    return this.service.returnable(purchaseOrderId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseReturnDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReturnStatusDto) {
    return this.service.setStatus(user.id, id, dto);
  }
}
