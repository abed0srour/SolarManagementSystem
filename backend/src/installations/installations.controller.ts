import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { InstallationsService } from './installations.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class InstallationDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsIn(['ON_GRID', 'OFF_GRID', 'HYBRID'])
  systemType?: string;

  @IsOptional()
  @IsString()
  siteAddress?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  capacityKw?: number;

  @IsOptional()
  @IsInt()
  panelCount?: number;

  @IsOptional()
  @IsNumber()
  batteryKwh?: number;

  @IsOptional()
  @IsNumber()
  tariffPerKwh?: number;

  @IsOptional()
  @IsNumber()
  expectedMonthlyKwh?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class InstallationUpdateDto extends InstallationDto {
  @IsOptional()
  @IsString()
  declare clientId: string;

  @IsOptional()
  @IsIn(['SURVEY', 'DESIGN', 'APPROVED', 'INSTALLING', 'COMMISSIONED', 'ACTIVE', 'ON_HOLD', 'CANCELLED'])
  status?: string;
}

class ReadingDto {
  @IsString()
  readingDate: string;

  @IsNumber()
  energyKwh: number;

  @IsOptional()
  @IsNumber()
  peakPowerKw?: number;

  @IsOptional()
  @IsNumber()
  sunHours?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class BulkReadingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReadingDto)
  readings: ReadingDto[];
}

@Controller('installations')
export class InstallationsController {
  constructor(private service: InstallationsService) {}

  @Get('fleet/stats')
  fleetStats() {
    return this.service.fleetStats();
  }

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: InstallationDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InstallationUpdateDto) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  @Get(':id/readings')
  readings(@Param('id') id: string, @Query() query: any) {
    return this.service.listReadings(id, query);
  }

  @Post(':id/readings')
  addReading(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReadingDto) {
    return this.service.upsertReading(user.id, id, dto);
  }

  @Post(':id/readings/bulk')
  bulkReadings(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BulkReadingsDto) {
    return this.service.bulkReadings(user.id, id, dto.readings);
  }

  @Delete(':id/readings/:readingId')
  deleteReading(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('readingId') readingId: string) {
    return this.service.deleteReading(user.id, id, readingId);
  }

  @Get(':id/production')
  production(@Param('id') id: string, @Query('months') months?: string) {
    return this.service.production(id, Math.min(Number(months) || 12, 36));
  }
}
