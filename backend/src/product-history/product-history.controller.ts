import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ProductHistoryService } from './product-history.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

const UNIT_STATUSES = ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'RETURNED_TO_SUPPLIER'] as const;

class SetStatusDto {
  @IsIn(UNIT_STATUSES)
  status: any;

  /** Why it moved — the part that is worth as much as the status itself. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  refType?: string;

  @IsOptional()
  @IsString()
  refId?: string;
}

class RegisterUnitsDto {
  @IsString()
  productId: string;

  @IsString()
  warehouseId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(18, { each: true })
  serialNumbers: string[];

  /** Which purchase order brought them in, so the supplier is recorded. */
  @IsOptional()
  @IsString()
  purchaseOrderId?: string;
}

@Controller('product-history')
export class ProductHistoryController {
  constructor(private service: ProductHistoryService) {}

  /** Every purchase of one product: suppliers, quantities and how price moved. */
  @Get('products/:productId/purchases')
  purchases(@Param('productId') productId: string) {
    return this.service.purchaseHistory(productId);
  }

  /** Which suppliers the faults cluster around, against what they shipped. */
  @Get('supplier-faults')
  supplierFaults(@Query() query: any) {
    return this.service.supplierFaultReport(query);
  }

  /** Filter units by product, supplier, status or serial. */
  @Get('units')
  units(@Query() query: any) {
    return this.service.units(query);
  }

  // Must stay above ':id', or a serial lookup is read as a unit id.
  @Get('units/serial/:serial')
  bySerial(@Param('serial') serial: string) {
    return this.service.findBySerial(serial);
  }

  /** One unit in full: supplier, documents, warranty and its whole history. */
  @Get('units/:id')
  unit(@Param('id') id: string) {
    return this.service.unit(id);
  }

  @Post('units')
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterUnitsDto) {
    return this.service.register(user.id, dto);
  }

  @Patch('units/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.service.setStatus(user.id, id, dto);
  }
}
