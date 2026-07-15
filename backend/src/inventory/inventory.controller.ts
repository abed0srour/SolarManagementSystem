import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength, NotEquals } from 'class-validator';
import { StockService } from './stock.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class AdjustmentDto {
  @IsString()
  productId: string;

  @IsString()
  warehouseId: string;

  @IsInt()
  @NotEquals(0)
  delta: number;

  @IsString()
  @MinLength(2)
  reason: string;
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
