import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QuotationsService } from './quotations.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { LineItemDto } from '../common/line-item.dto';

class QuotationDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: string;

  @IsOptional()
  @IsNumber()
  discountValue?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  items: LineItemDto[];
}

class UpdateQuotationDto extends QuotationDto {
  @IsOptional()
  @IsString()
  declare clientId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  declare items: LineItemDto[];
}

class ConvertDto {
  @IsString()
  warehouseId: string;
}

@Controller('quotations')
export class QuotationsController {
  constructor(private service: QuotationsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: QuotationDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateQuotationDto) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/convert')
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConvertDto) {
    return this.service.convertToOrder(user.id, id, dto.warehouseId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
