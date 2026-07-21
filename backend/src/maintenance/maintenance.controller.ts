import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { MaintenanceService } from './maintenance.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ContractDto {
  @IsString()
  installationId: string;

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsInt()
  visitsPerYear?: number;

  @IsOptional()
  @IsNumber()
  pricePerYear?: number;

  @IsOptional()
  @IsString()
  nextVisitDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ContractUpdateDto extends ContractDto {
  @IsOptional()
  @IsString()
  declare installationId: string;

  @IsOptional()
  @IsString()
  declare startDate: string;

  @IsOptional()
  @IsString()
  declare endDate: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'CANCELLED'])
  status?: string;
}

class VisitDto {
  @IsOptional()
  @IsString()
  visitDate?: string;

  @IsOptional()
  @IsString()
  technicianName?: string;

  @IsOptional()
  @IsBoolean()
  createServiceJob?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('maintenance-contracts')
export class MaintenanceController {
  constructor(private service: MaintenanceService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: ContractDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ContractUpdateDto) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/visit')
  recordVisit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VisitDto) {
    return this.service.recordVisit(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
