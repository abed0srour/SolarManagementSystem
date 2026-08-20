import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class PoItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitCost: number;
}

class PurchaseOrderDto {
  @IsString()
  supplierId: string;

  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsIn(['DRAFT', 'SENT'])
  status?: string;

  @IsOptional()
  @IsString()
  expectedDelivery?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  hasDeliveryCost?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryCost?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  items: PoItemDto[];
}

class UpdatePurchaseOrderDto extends PurchaseOrderDto {
  @IsOptional()
  @IsString()
  declare supplierId: string;

  @IsOptional()
  @IsString()
  declare warehouseId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  declare items: PoItemDto[];
}

class ReceiveLineDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsArray()
  serialNumbers?: string[];

  @IsOptional()
  @IsString()
  manufactureDate?: string;
}

class ReceiveDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

class StatusDto {
  @IsIn(['DRAFT', 'SENT', 'CLOSED', 'CANCELLED'])
  status: string;
}

class PayDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['CASH', 'WHISH', 'OMT'])
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

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private service: PurchaseOrdersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.service.usage(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: PurchaseOrderDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/receive')
  receive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReceiveDto) {
    return this.service.receive(user.id, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }

  @Post(':id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.service.setStatus(user.id, id, dto.status);
  }

  @Post(':id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PayDto) {
    return this.service.pay(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restore(user.id, id);
  }
}
