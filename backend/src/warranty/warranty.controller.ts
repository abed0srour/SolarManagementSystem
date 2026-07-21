import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { WarrantyService } from './warranty.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ClaimDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsString()
  @MinLength(3)
  issue: string;
}

class ClaimUpdateDto {
  @IsOptional()
  @IsIn(['OPEN', 'SENT_TO_SUPPLIER', 'RESOLVED', 'REPLACED', 'REJECTED'])
  status?: string;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  issue?: string;
}

@Controller('warranty')
export class WarrantyController {
  constructor(private service: WarrantyService) {}

  @Get('claims')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('expiring')
  expiring(@Query() query: any) {
    return this.service.expiringSoon(query.days ? Number(query.days) : 60, query);
  }

  @Get('claims/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('claims')
  create(@CurrentUser() user: AuthUser, @Body() dto: ClaimDto) {
    return this.service.create(user.id, dto);
  }

  @Patch('claims/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ClaimUpdateDto) {
    return this.service.update(user.id, id, dto);
  }
}
