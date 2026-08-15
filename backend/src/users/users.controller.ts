import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { SuperAdminOnly } from '../auth/super-admin.decorator';

const ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsIn(ASSIGNABLE_ROLES)
  role: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Set by the super admin to reset a forgotten password. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

@SuperAdminOnly()
@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  @Get('catalog')
  catalog() {
    return this.service.catalog();
  }

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
