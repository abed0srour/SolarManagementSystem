import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { RefundsService } from './refunds.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ReturnItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsIn(['RESELLABLE', 'DAMAGED'])
  condition?: string;

  @IsOptional()
  @IsArray()
  serialNumbers?: string[];
}

class RefundDto {
  @IsString()
  invoiceId: string;

  @IsOptional()
  @IsIn(['DEFECTIVE', 'WRONG_ITEM', 'CHANGE_OF_MIND', 'OTHER'])
  reason?: string;

  @IsOptional()
  @IsIn(['CASH', 'STORE_CREDIT', 'EXCHANGE'])
  method?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

class CompleteDto {
  @IsString()
  warehouseId: string;
}

class RejectDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('refunds')
export class RefundsController {
  constructor(private service: RefundsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: RefundDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.service.reject(user.id, id, dto.reason);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CompleteDto) {
    return this.service.complete(user.id, id, dto.warehouseId);
  }
}
