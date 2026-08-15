import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { StockService } from './stock.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class AdjustmentDto {
  @IsString()
  productId: string;

  @IsString()
  warehouseId: string;

  // Not @IsInt: stock is stored as a Decimal because metered goods (cable,
  // conduit) are counted in metres, so 12.5 is a legitimate adjustment.
  @IsNumber()
  @NotEquals(0)
  delta: number;

  @IsString()
  @MinLength(2)
  reason: string;

  /**
   * Cost of the units being added. Re-costs the product on the weighted average,
   * the same as a goods receipt. Only meaningful when `delta` is positive.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;
}

class TransferDto {
  @IsString()
  productId: string;

  @IsString()
  fromWarehouseId: string;

  @IsString()
  toWarehouseId: string;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsArray()
  serialNumbers?: string[];
}

class WarehouseDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class UnitUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(18)
  serialNumber?: string;

  @IsOptional()
  @IsIn(['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED', 'RETURNED_TO_SUPPLIER'])
  status?: any;

  @IsOptional()
  @IsString()
  manufactureDate?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

@Controller('inventory')
export class InventoryController {
  constructor(private stock: StockService) {}

  @Get('overview')
  overview(@Query() query: any) {
    return this.stock.stockOverview(query);
  }

  @Get('movements')
  movements(@Query() query: any) {
    return this.stock.movements(query);
  }

  @Post('adjust')
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustmentDto) {
    return this.stock.manualAdjustment(user.id, dto);
  }

  @Post('transfer')
  transfer(@CurrentUser() user: AuthUser, @Body() dto: TransferDto) {
    return this.stock.transfer(user.id, dto);
  }

  @Get('warehouses')
  warehouses() {
    return this.stock.warehouses();
  }

  @Post('warehouses')
  createWarehouse(@CurrentUser() user: AuthUser, @Body() dto: WarehouseDto) {
    return this.stock.createWarehouse(user.id, dto);
  }

  @Patch('warehouses/:id')
  updateWarehouse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<WarehouseDto & { isActive: boolean }>) {
    return this.stock.updateWarehouse(user.id, id, dto);
  }

  @Get('warehouses/:id/usage')
  warehouseUsage(@Param('id') id: string) {
    return this.stock.warehouseUsageReport(id);
  }

  @Delete('warehouses/:id')
  removeWarehouse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stock.removeWarehouse(user.id, id);
  }

  @Post('warehouses/:id/restore')
  restoreWarehouse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stock.restoreWarehouse(user.id, id);
  }

  @Get('units')
  units(@Query() query: any) {
    return this.stock.units(query);
  }

  @Get('units/serial/:serial')
  lookupSerial(@Param('serial') serial: string) {
    return this.stock.lookupSerial(serial);
  }

  @Patch('units/:id')
  updateUnit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UnitUpdateDto) {
    return this.stock.updateUnit(user.id, id, dto);
  }
}
