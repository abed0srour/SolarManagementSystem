import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { ExpensesService } from './expenses.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

const CATEGORIES = ['RENT', 'SALARIES', 'UTILITIES', 'TRANSPORT', 'MARKETING', 'EQUIPMENT', 'MAINTENANCE', 'OTHER'];
const METHODS = ['CASH', 'WHISH', 'OMT'];

class ExpenseDto {
  @IsIn(CATEGORIES)
  category: string;

  @IsString()
  description: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsIn(METHODS)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ExpenseUpdateDto extends ExpenseDto {
  @IsOptional()
  @IsIn(CATEGORIES)
  declare category: string;

  @IsOptional()
  @IsString()
  declare description: string;

  @IsOptional()
  @IsNumber()
  declare amount: number;
}

@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.summary(from, to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: ExpenseDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ExpenseUpdateDto) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }

  /** Bring an archived record back into the active list. */
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restore(user.id, id);
  }
}
