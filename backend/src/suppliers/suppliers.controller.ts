import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { SuppliersService } from './suppliers.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class SupplierDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsInt()
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class SupplierPriceDto {
  @IsString()
  productId: string;

  @IsNumber()
  supplierPrice: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

class SupplierReturnDto {
  @IsString()
  supplierId: string;

  @IsArray()
  items: any[]; // [{ productId, quantity, serialNumbers?, reason? }]

  @IsOptional()
  @IsString()
  notes?: string;
}

class SupplierReturnUpdateDto {
  @IsOptional()
  @IsIn(['PENDING', 'SENT', 'CREDITED', 'REPLACED', 'CLOSED'])
  status?: any;

  @IsOptional()
  @IsString()
  creditNoteRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private service: SuppliersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('returns')
  returns(@Query() query: any) {
    return this.service.supplierReturns(query);
  }

  @Post('returns')
  createReturn(@CurrentUser() user: AuthUser, @Body() dto: SupplierReturnDto) {
    return this.service.createSupplierReturn(user.id, dto);
  }

  @Patch('returns/:id')
  updateReturn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SupplierReturnUpdateDto) {
    return this.service.updateSupplierReturn(user.id, id, dto);
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

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SupplierDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<SupplierDto & { isActive: boolean }>) {
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

  @Post(':id/prices')
  setPrice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SupplierPriceDto) {
    return this.service.setSupplierPrice(user.id, id, dto.productId, dto.supplierPrice, dto.currency);
  }

  @Delete('prices/:priceId')
  removePrice(@CurrentUser() user: AuthUser, @Param('priceId') priceId: string) {
    return this.service.removeSupplierPrice(user.id, priceId);
  }
}
