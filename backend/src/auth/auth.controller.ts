import { Body, Controller, Get, Ip, Patch, Post, Query, Headers } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { AuthUser, CurrentUser } from './user.decorator';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

class RefreshDto {
  @IsString()
  refreshToken: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  name: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class RequestEmailChangeDto {
  @IsString()
  currentPassword: string;

  @IsEmail()
  newEmail: string;
}

class ConfirmEmailChangeDto {
  @IsString()
  code: string;
}

class RequestPasswordChangeDto {
  @IsString()
  currentPassword: string;
}

class ConfirmPasswordChangeDto {
  @IsString()
  code: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto.email, dto.password, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('login-history')
  loginHistory(@Query() query: any) {
    return this.authService.loginHistory(query);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.authService.profile(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Post('revoke-sessions')
  revokeSessions(@CurrentUser() user: AuthUser) {
    return this.authService.revokeOtherSessions(user.id);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('request-email-change')
  requestEmailChange(@CurrentUser() user: AuthUser, @Body() dto: RequestEmailChangeDto) {
    return this.authService.requestEmailChange(user.id, dto.currentPassword, dto.newEmail);
  }

  @Post('confirm-email-change')
  confirmEmailChange(@CurrentUser() user: AuthUser, @Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(user.id, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('request-password-change')
  requestPasswordChange(@CurrentUser() user: AuthUser, @Body() dto: RequestPasswordChangeDto) {
    return this.authService.requestPasswordChange(user.id, dto.currentPassword);
  }

  @Post('confirm-password-change')
  confirmPasswordChange(@CurrentUser() user: AuthUser, @Body() dto: ConfirmPasswordChangeDto) {
    return this.authService.confirmPasswordChange(user.id, dto.code, dto.newPassword);
  }
}
