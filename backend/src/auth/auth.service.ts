import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { getTenantContext, runUnscoped } from '../common/tenant-context';
import { AuthUser } from './user.decorator';

/**
 * What is left of authentication on this side.
 *
 * Credentials, sessions, password resets and email changes all belong to
 * Supabase Auth now, and the browser talks to it directly — there is no value
 * in this API proxying a call it would only forward verbatim, and every proxy
 * hop is another place for the session to get out of step with the token the
 * client actually holds.
 *
 * What stays here is what Supabase has no opinion about: this application's own
 * view of an account, its sign-in history, and keeping the `profiles` row in
 * step when someone edits their details.
 */
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Records a successful sign-in.
   *
   * Supabase does not write to this application's LoginHistory, so the client
   * reports it after `signInWithPassword` succeeds. This is bookkeeping for the
   * account's own security page, never a grant of anything — the token was
   * already verified by the guard before this method could run.
   */
  async recordSignIn(user: AuthUser, ip?: string, userAgent?: string) {
    const write = () =>
      this.prisma.loginHistory.create({
        data: {
          userId: user.id,
          tenantId: user.tenantId,
          email: user.email,
          success: true,
          ip,
          userAgent,
        },
      });
    // A super admin has no tenant, so the ambient scoping has nothing to apply.
    user.tenantId ? await write() : await runUnscoped(async () => write());
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    return { success: true };
  }

  /**
   * The account's own profile card: identity plus a couple of security facts
   * worth seeing at a glance.
   */
  async profile(userId: string) {
    const load = async () => {
      const profile = await this.prisma.profile.findUnique({
        where: { id: userId },
        include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
      });
      if (!profile) throw new NotFoundException('Profile not found');

      const lastLogin = await this.prisma.loginHistory.findFirst({
        where: { userId, success: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, ip: true, userAgent: true },
      });

      return {
        id: profile.id,
        email: profile.email,
        name: profile.fullName,
        phone: profile.phone,
        avatarUrl: profile.avatarUrl,
        role: profile.appRole,
        profileRole: profile.role,
        isActive: profile.isActive,
        createdAt: profile.createdAt,
        tenant: profile.tenant,
        lastLogin,
      };
    };
    return getTenantContext().tenantId ? load() : runUnscoped(load);
  }

  /**
   * Update the display details.
   *
   * Writes `profiles`, which is the source of truth; a database trigger pushes
   * the change on to the `"User"` row that business records point at. The
   * client also calls `supabase.auth.updateUser({ data })` so the same values
   * live in user_metadata and appear on the next token — the two are kept
   * deliberately in step rather than one being derived from the other, because
   * only one of them can be read without a database round trip.
   */
  async updateProfile(userId: string, data: { name?: string; phone?: string; avatarUrl?: string }) {
    const name = data.name?.trim();
    if (name !== undefined && !name) throw new BadRequestException('Name cannot be empty');

    const write = () =>
      this.prisma.profile.update({
        where: { id: userId },
        data: {
          fullName: name,
          phone: data.phone?.trim(),
          avatarUrl: data.avatarUrl?.trim(),
        },
        select: { id: true, email: true, fullName: true, phone: true, avatarUrl: true, role: true, appRole: true },
      });

    const profile = await (getTenantContext().tenantId ? write() : runUnscoped(async () => write()));
    await this.audit.log(userId, 'UPDATE_PROFILE', 'Profile', userId, { name, phone: data.phone });
    return profile;
  }

  /** Sign-in history for this store, newest first. */
  loginHistory(query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 30, 200);
    const run = async () => {
      const [items, total] = await Promise.all([
        this.prisma.loginHistory.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.loginHistory.count(),
      ]);
      return { items, total, page, pageSize };
    };
    return getTenantContext().tenantId ? run() : runUnscoped(run);
  }
}
