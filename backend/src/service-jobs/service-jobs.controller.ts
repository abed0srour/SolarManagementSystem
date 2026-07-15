import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { ServiceJobsService } from './service-jobs.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class ServiceJobDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsIn(['INSTALLATION', 'MAINTENANCE', 'SURVEY', 'REPAIR'])
  type?: string;

  @IsOptional()
  @IsString()
  technicianName?: string;

  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ServiceJobUpdateDto extends ServiceJobDto {
  @IsOptional()
  @IsString()
  declare clientId: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: string;
}

@Controller('service-jobs')
export class ServiceJobsController {
  constructor(private service: ServiceJobsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: ServiceJobDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ServiceJobUpdateDto) {
    return this.service.update(user.id, id, dto);
  }
}
