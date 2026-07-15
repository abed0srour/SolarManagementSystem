import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 7;

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  private async issueTokens(user: { id: string; email: string; name: string; role: string }) {
    const payload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 3600 * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const logAttempt = (success: boolean) =>
      this.prisma.loginHistory.create({
        data: { userId: user?.id, email, success, ip, userAgent },
      });

    if (!user || !user.isActive || user.deletedAt) {
      await logAttempt(false);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logAttempt(false);
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`Account locked — try again in ${minutes} minute(s)`);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
      await logAttempt(false);
      throw new UnauthorizedException(
        attempts >= MAX_FAILED_ATTEMPTS
          ? `Account locked for ${LOCK_MINUTES} minutes after ${attempts} failed attempts`
          : 'Invalid credentials',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await logAttempt(true);
    const tokens = await this.issueTokens(user);
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  /** Rotate a refresh token: revoke the presented one and issue a fresh pair. */
  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const tokens = await this.issueTokens(stored.user);
    return {
      ...tokens,
      user: { id: stored.user.id, email: stored.user.email, name: stored.user.name, role: stored.user.role },
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  /**
   * Create a one-hour password reset token. There is no SMTP integration yet, so the
   * token is returned in the response for the admin to use directly (single-admin system);
   * wire this to an email provider before exposing the API publicly.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return { success: true }; // don't reveal whether the email exists
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) },
    });
    await this.audit.log(user.id, 'FORGOT_PASSWORD', 'User', user.id);
    return { success: true, resetToken: token };
  }

  async resetPassword(token: string, newPassword: string) {
    if (newPassword.length < 8) throw new BadRequestException('New password must be at least 8 characters');
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date())
      throw new BadRequestException('Invalid or expired reset token');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log(stored.userId, 'RESET_PASSWORD', 'User', stored.userId);
    return { success: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (newPassword.length < 8) throw new BadRequestException('New password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log(userId, 'CHANGE_PASSWORD', 'User', userId);
    return { success: true };
  }

  loginHistory(query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 30, 200);
    return this.prisma.loginHistory
      .findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
      .then(async (items) => ({ items, total: await this.prisma.loginHistory.count(), page, pageSize }));
  }
}
