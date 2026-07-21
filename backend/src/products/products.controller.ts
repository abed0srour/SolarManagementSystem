import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductsService } from './products.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class CreateProductDto {
  @IsString()
  @MinLength(1)
  sku: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsString()
  subCategoryId: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsNumber()
  @Min(0)
  costPrice: number;

  @IsNumber()
  @Min(0)
  salePrice: number;

  @IsOptional()
  @IsBoolean()
  trackSerials?: boolean;

  @IsOptional()
  @IsBoolean()
  isService?: boolean;

  @IsOptional()
  @IsArray()
  serialNumbers?: string[];

  @IsOptional()
  @IsInt()
  lowStockThreshold?: number;

  @IsOptional()
  @IsInt()
  warrantyMonths?: number;

  @IsOptional()
  @IsInt()
  performanceWarrantyMonths?: number;

  @IsOptional()
  @IsInt()
  shelfLifeMonths?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdateProductDto extends CreateProductDto {
  @IsOptional()
  @IsString()
  declare sku: string;

  @IsOptional()
  @IsString()
  declare name: string;

  @IsOptional()
  @IsString()
  declare subCategoryId: string;

  @IsOptional()
  @IsNumber()
  declare costPrice: number;

  @IsOptional()
  @IsNumber()
  declare salePrice: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  priceChangeReason?: string;
}

class BulkPriceRowDto {
  @IsString()
  sku: string;

  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  salePrice?: number;
}

class BulkPriceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkPriceRowDto)
  rows: BulkPriceRowDto[];

  @IsOptional()
  @IsString()
  reason?: string;
}

class CompatibilityDto {
  @IsString()
  compatibleWithId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('brands')
  brands() {
    return this.service.brands();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/price-history')
  priceHistory(@Param('id') id: string) {
    return this.service.priceHistory(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.service.create(user.id, dto);
  }

  @Post('bulk-price')
  bulkPrice(@CurrentUser() user: AuthUser, @Body() dto: BulkPriceDto) {
    return this.service.bulkPriceUpdate(user.id, dto.rows, dto.reason);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Post(':id/compatibility')
  addCompat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CompatibilityDto) {
    return this.service.addCompatibility(user.id, id, dto.compatibleWithId, dto.note);
  }

  @Delete('compatibility/:linkId')
  removeCompat(@CurrentUser() user: AuthUser, @Param('linkId') linkId: string) {
    return this.service.removeCompatibility(user.id, linkId);
  }
}
