import { Body, Controller, Get, Headers, Ip, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser } from './user.decorator';

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() avatarUrl?: string;
}

/**
 * Session-adjacent endpoints only.
 *
 * Sign-in, sign-out, token refresh, password reset and email change are not
 * here: the browser performs them against Supabase Auth directly with
 * `supabase.auth.*`. Mirroring them behind this API would add a hop that can
 * only ever return a slightly staler version of the same answer, and would
 * mean two implementations of the same rules to keep in agreement.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** Identity as this API sees it, decoded from the token — no database read. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Called by the client after a successful Supabase sign-in. */
  @Post('session')
  recordSignIn(@CurrentUser() user: AuthUser, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.authService.recordSignIn(user, ip, userAgent);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.authService.profile(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Get('login-history')
  loginHistory(@Query() query: any) {
    return this.authService.loginHistory(query);
  }
}
