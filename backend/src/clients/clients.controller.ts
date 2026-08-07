import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClientsService } from './clients.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class AddressDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @MinLength(1)
  line1: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsBoolean()
  isBilling?: boolean;

  @IsOptional()
  @IsBoolean()
  isInstallation?: boolean;
}

class ClientDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsIn(['INDIVIDUAL', 'BUSINESS'])
  type?: string;

  @IsOptional()
  @IsIn(['RETAIL', 'WHOLESALE', 'INSTALLER'])
  tier?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  addresses?: AddressDto[];
}

@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id/brief')
  brief(@Param('id') id: string) {
    return this.service.brief(id);
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
  create(@CurrentUser() user: AuthUser, @Body() dto: ClientDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<ClientDto>) {
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
}
