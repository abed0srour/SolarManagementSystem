import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { SuperadminService } from './superadmin.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';
import { SuperAdminOnly } from '../auth/super-admin.decorator';

class CreateTenantDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() slug?: string;

  @IsString() @MinLength(1) adminName: string;
  @IsEmail() adminEmail: string;
  @IsOptional() @IsString() @MinLength(8) adminPassword?: string;
  /** Email an invite link instead of setting a password now. */
  @IsOptional() @IsBoolean() invite?: boolean;

  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) maxUsers?: number;
  @IsOptional() @IsInt() @Min(1) maxProducts?: number;
  @IsOptional() @IsInt() @Min(1) maxClients?: number;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

class UpdateTenantDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) maxUsers?: number;
  @IsOptional() @IsInt() @Min(1) maxProducts?: number;
  @IsOptional() @IsInt() @Min(1) maxClients?: number;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

class SetStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'ARCHIVED']) status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  @IsOptional() @IsString() reason?: string;
}

class ResetPasswordDto {
  @IsString() @MinLength(8) password: string;
}

class SetActiveDto {
  @IsBoolean() isActive: boolean;
}

/**
 * The platform portal. Every route here is super-admin-only, enforced twice
 * over: by the decorator below, and by `PermissionsGuard` treating any path
 * under /superadmin as a platform route regardless of what the decorator says.
 * Two independent checks, because forgetting the decorator on one new method
 * should not open the door to every store on the platform.
 */
@ApiTags('superadmin')
@SuperAdminOnly()
@Controller('superadmin')
export class SuperadminController {
  constructor(private service: SuperadminService) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('tenants')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('tenants/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get('tenants/:id/stats')
  stats(@Param('id') id: string) {
    return this.service.stats(id);
  }

  @Post('tenants')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.service.createTenant(user.id, dto);
  }

  @Patch('tenants/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.service.updateTenant(user.id, id, dto);
  }

  @Patch('tenants/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.service.setStatus(user.id, id, dto.status, dto.reason);
  }

  @Delete('tenants/:id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archiveTenant(user.id, id);
  }

  @Post('tenants/:id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.restoreTenant(user.id, id);
  }

  @Post('tenants/:id/members/:userId/password')
  resetMemberPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.service.resetMemberPassword(user.id, id, userId, dto.password);
  }

  @Patch('tenants/:id/members/:userId/active')
  setMemberActive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.service.setMemberActive(user.id, id, userId, dto.isActive);
  }

  @Delete('tenants/:id/members/:userId')
  deleteMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.service.deleteMember(user.id, id, userId);
  }
}
