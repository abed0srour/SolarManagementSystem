import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { runUnscoped } from '../common/tenant-context';

export interface ProvisionUserInput {
  email: string;
  password?: string;
  fullName?: string;
  phone?: string;
  /** 'super_admin' | 'tenant_admin' | 'staff' */
  role: string;
  /** Null only for a super admin. */
  tenantId: string | null;
  /** ADMIN | MANAGER | STAFF | VIEWER */
  appRole?: string;
  permissions?: string[];
}

/**
 * Everything that needs the Supabase service role key.
 *
 * This key can do anything to any account, so it lives only here and only on
 * the server. Account creation, credential resets and deletion are exposed as
 * ordinary NestJS endpoints guarded by role, rather than letting a browser hold
 * a key that bypasses every policy in the database.
 *
 * Note that `auth.admin.createUser` fires the `on_auth_user_created` trigger,
 * which is what actually writes the profile and the matching `"User"` row. The
 * app_metadata passed here is therefore not decoration -- it is the input that
 * decides which store the new account belongs to.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private client?: SupabaseClient;

  constructor(private prisma: PrismaService) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      this.logger.error(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — account provisioning is disabled.',
      );
      return;
    }
    this.client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  get enabled(): boolean {
    return !!this.client;
  }

  private admin(): SupabaseClient {
    if (!this.client) {
      throw new InternalServerErrorException(
        'Supabase admin access is not configured on this server (SUPABASE_SERVICE_ROLE_KEY).',
      );
    }
    return this.client;
  }

  private appMetadata(input: ProvisionUserInput) {
    return {
      role: input.role,
      tenant_id: input.tenantId,
      app_role: input.appRole ?? (input.role === 'tenant_admin' ? 'ADMIN' : 'STAFF'),
      permissions: input.permissions ?? [],
    };
  }

  /** Create an account with a password chosen now. Used when provisioning a store. */
  async createUser(input: ProvisionUserInput): Promise<User> {
    if (input.password && input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const { data, error } = await this.admin().auth.admin.createUser({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      // The store owner hands the password over directly; making them confirm an
      // email first would leave the account unusable if the mail never arrives.
      email_confirm: true,
      app_metadata: this.appMetadata(input),
      user_metadata: { full_name: input.fullName ?? '', phone: input.phone ?? '' },
    });
    if (error) throw new BadRequestException(this.readable(error.message));
    return data.user;
  }

  /** Invite by email instead of setting a password. */
  async inviteUser(input: ProvisionUserInput, redirectTo?: string): Promise<User> {
    const { data, error } = await this.admin().auth.admin.inviteUserByEmail(
      input.email.trim().toLowerCase(),
      {
        data: { full_name: input.fullName ?? '', phone: input.phone ?? '' },
        redirectTo,
      },
    );
    if (error) throw new BadRequestException(this.readable(error.message));
    // inviteUserByEmail takes no app_metadata, so the tenant is applied straight
    // after. Without this the trigger would have refused the row for having no
    // tenant, so the update is not optional bookkeeping.
    await this.updateAppMetadata(data.user.id, input);
    return data.user;
  }

  /**
   * Send someone a fresh link to set their password.
   *
   * Not a second `inviteUserByEmail`: that call refuses an address which
   * already has an account, which is every case where the mail needs sending
   * again. A recovery mail lands on the same /reset-password screen and has the
   * same effect for someone who never set a password in the first place, and it
   * works whether or not the original invite was ever opened.
   *
   * The project's own rate limit still applies -- Supabase refuses a second
   * mail to the same address inside the configured interval, and that refusal
   * is surfaced rather than swallowed so the caller can say why.
   */
  async sendPasswordSetupEmail(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.admin().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    if (error) throw new BadRequestException(this.readable(error.message));
  }

  async updateAppMetadata(userId: string, input: ProvisionUserInput): Promise<void> {
    const { error } = await this.admin().auth.admin.updateUserById(userId, {
      app_metadata: this.appMetadata(input),
    });
    if (error) throw new BadRequestException(this.readable(error.message));

    // Ensure public.profiles reflects the tenant and role immediately
    await runUnscoped(async () => {
      await this.prisma.profile
        .update({
          where: { id: userId },
          data: {
            role: input.role,
            tenantId: input.tenantId,
            appRole: input.appRole ?? (input.role === 'tenant_admin' ? 'ADMIN' : 'STAFF'),
            permissions: input.permissions ?? [],
            fullName: input.fullName,
            phone: input.phone,
          },
        })
        .catch((err) => {
          this.logger.warn(`Could not sync profile for user ${userId}: ${err.message}`);
        });
    });
  }

  async setPassword(userId: string, password: string): Promise<void> {
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const { error } = await this.admin().auth.admin.updateUserById(userId, { password });
    if (error) throw new BadRequestException(this.readable(error.message));
  }

  async setEmail(userId: string, email: string): Promise<void> {
    const { error } = await this.admin().auth.admin.updateUserById(userId, {
      email: email.trim().toLowerCase(),
      email_confirm: true,
    });
    if (error) throw new BadRequestException(this.readable(error.message));
  }

  async setBanned(userId: string, banned: boolean): Promise<void> {
    const { error } = await this.admin().auth.admin.updateUserById(userId, {
      // 'none' lifts a ban; any duration bans. Used to lock out every member of
      // a suspended store immediately rather than when their token expires.
      ban_duration: banned ? '876000h' : 'none',
    });
    if (error) throw new BadRequestException(this.readable(error.message));
  }

  /**
   * End every session for an account.
   *
   * Claims are signed into the token, so a demotion or a suspension does not
   * take effect until the token is reissued. Anything that changes what an
   * account may do must call this, or the change is advisory for up to an hour.
   */
  async signOutEverywhere(userId: string): Promise<void> {
    const { error } = await this.admin().auth.admin.signOut(userId, 'global');
    // A user with no active session is not a failure worth surfacing.
    if (error && !/not found|session/i.test(error.message)) {
      this.logger.warn(`Could not revoke sessions for ${userId}: ${error.message}`);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.admin().auth.admin.deleteUser(userId);
    if (error) throw new BadRequestException(this.readable(error.message));
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.admin().auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new BadRequestException(this.readable(error.message));
    const target = email.trim().toLowerCase();
    return data.users.find((u) => u.email?.toLowerCase() === target) ?? null;
  }

  private readable(message: string): string {
    if (/already been registered|already exists|duplicate key|database error saving new user/i.test(message)) {
      return 'An account with this email already exists';
    }
    return message;
  }
}
