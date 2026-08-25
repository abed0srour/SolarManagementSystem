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

  // Optional at this layer because services are filed automatically under the
  // "Services" sub-category. ProductsService rejects a non-service without one.
  @IsOptional()
  @IsString()
  subCategoryId?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  // Optional for stocked products: the first goods receipt sets the real cost
  // via weighted average. Services still send it, since no purchase ever will.
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsNumber()
  @Min(0)
  salePrice: number;

  @IsOptional()
  @IsBoolean()
  trackSerials?: boolean;

  @IsOptional()
  @IsBoolean()
  requireSerialOnSale?: boolean;

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
  imageUrl?: string;

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
  declare subCategoryId?: string;

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

/**
 * One CSV line. Everything is optional at this layer so a malformed row is
 * reported per-row by the service rather than rejecting the whole file.
 */
class ImportRowDto {
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() salePrice?: number;
  @IsOptional() @IsNumber() costPrice?: number;
  @IsOptional() @IsNumber() lowStockThreshold?: number;
  @IsOptional() @IsNumber() warrantyMonths?: number;
  @IsOptional() @IsBoolean() isService?: boolean;
}

class ImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}

class CompatibilityDto {
  @IsString()
  compatibleWithId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ProductAttributeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  type: 'STRING' | 'INTEGER' | 'DECIMAL' | 'FLOAT' | 'BOOLEAN';

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isFreeForm?: boolean;

  @IsOptional()
  @IsArray()
  permittedValues?: any[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class SetProductAttributesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeDto)
  attributes: ProductAttributeDto[];
}

export class GenerateVariantItemDto {
  @IsString()
  @MinLength(1)
  sku: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  @Min(0)
  salePrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsObject()
  variantAttributes: Record<string, any>;
}

export class GenerateVariantsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeDto)
  attributes?: ProductAttributeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GenerateVariantItemDto)
  variants: GenerateVariantItemDto[];
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

  // Must stay above `@Get(':id')`, or 'generate-sku' is read as an id.
  @Get('generate-sku')
  generateSku() {
    return this.service.generateSku();
  }

  /** Tells the confirm dialog whether Delete or Archive applies. */
  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.service.usage(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/price-history')
  priceHistory(@Param('id') id: string) {
    return this.service.priceHistory(id);
  }

  /** Clients who bought this product, one row per sales-order line. */
  @Get(':id/buyers')
  buyers(@Param('id') id: string, @Query() query: any) {
    return this.service.buyers(id, query);
  }

  /** Dynamic Attributes & Variants */
  @Get(':id/variants')
  getVariants(@Param('id') id: string) {
    return this.service.getVariants(id);
  }

  @Post(':id/attributes')
  setAttributes(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetProductAttributesDto,
  ) {
    return this.service.setAttributes(user.id, id, dto.attributes);
  }

  @Post(':id/generate-variants')
  generateVariants(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: GenerateVariantsDto,
  ) {
    return this.service.generateVariants(user.id, id, dto);
  }

  @Delete(':id/variants/:variantId')
  deleteVariant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ) {
    return this.service.deleteVariant(user.id, id, variantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.service.create(user.id, dto);
  }

  @Post('bulk-price')
  bulkPrice(@CurrentUser() user: AuthUser, @Body() dto: BulkPriceDto) {
    return this.service.bulkPriceUpdate(user.id, dto.rows, dto.reason);
  }

  @Post('import')
  importProducts(@CurrentUser() user: AuthUser, @Body() dto: ImportDto) {
    return this.service.importProducts(user.id, dto.rows);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(user.id, id, dto);
  }

  /** Bring an archived record back into the active list. */
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restore(user.id, id);
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
