import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { WorkersService } from './workers.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class WorkerDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsIn(['DAILY', 'HOURLY']) payBasis?: string;
  @IsOptional() @IsNumber() @Min(0) dailyRate?: number;
  @IsOptional() @IsNumber() @Min(0) hourlyRate?: number;
  @IsOptional() @IsNumber() @Min(0) expectedHoursPerDay?: number;
  @IsOptional() @IsNumber() @Min(0) lateDeductionPerHour?: number;
  @IsOptional() @IsIn(['WEEKLY', 'MONTHLY']) payPeriod?: string;
  @IsOptional() @IsString() hiredOn?: string;
  @IsOptional() @IsString() notes?: string;
}

class UpdateWorkerDto extends WorkerDto {
  @IsOptional() @IsString() declare name: string;
}

class AttendanceDto {
  @IsString() date: string;
  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY']) status?: string;
  @IsOptional() @IsNumber() @Min(0) hoursWorked?: number;
  @IsOptional() @IsNumber() @Min(0) lateHours?: number;
  @IsOptional() @IsNumber() bonus?: number;
  @IsOptional() @IsNumber() deduction?: number;
  @IsOptional() @IsString() notes?: string;
}

@Controller('workers')
export class WorkersController {
  constructor(private service: WorkersService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  /** Settlement run across all workers. Must sit above `:id`. */
  @Get('payroll-summary')
  payrollSummary(@Query('from') from: string, @Query('to') to: string, @Query('payPeriod') payPeriod?: string) {
    return this.service.payrollSummary(from, to, payPeriod);
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.service.usage(id);
  }

  @Get(':id/attendance')
  attendance(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.attendance(id, from, to);
  }

  @Get(':id/payroll')
  payroll(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.payroll(id, from, to);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: WorkerDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/attendance')
  logAttendance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttendanceDto) {
    return this.service.logAttendance(user.id, id, dto);
  }

  @Delete('attendance/:entryId')
  removeAttendance(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string) {
    return this.service.removeAttendance(user.id, entryId);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWorkerDto) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restore(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
