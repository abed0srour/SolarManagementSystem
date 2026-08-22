import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { PermissionsGuard } from './permissions.guard';
import { SupabaseTokenService } from './supabase-token.service';
import { SupabaseAdminService } from './supabase-admin.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SupabaseTokenService,
    SupabaseAdminService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Registered after JwtAuthGuard so request.user is populated when it runs.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SupabaseTokenService, SupabaseAdminService],
})
export class AuthModule {}
