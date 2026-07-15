import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SalesOrdersService } from './sales-orders.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { LineItemDto } from '../common/line-item.dto';

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

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private service: SalesOrdersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
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

  @Post(':id/deliver')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeliverDto) {
    return this.service.deliver(user.id, id, dto.deliveries);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }
}
