import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

/**
 * What a Tenant Admin may hand out inside their own store.
 *
 * ADMIN is absent deliberately: appointing another store admin is the platform
 * owner's call, so that one compromised admin account cannot entrench itself by
 * minting peers. SUPER_ADMIN is a platform role and was never assignable here.
 */
const ASSIGNABLE_ROLES = ['MANAGER', 'STAFF', 'VIEWER'];

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

  /** Set by a store admin to reset a forgotten password. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

/**
 * Staff accounts for one store.
 *
 * Guarded by the `users` permission rather than a super-admin check: under
 * multi-tenancy a store has to be able to manage its own people, and every
 * query in the service is tenant-scoped, so this controller cannot see another
 * store even if it tried.
 */
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
