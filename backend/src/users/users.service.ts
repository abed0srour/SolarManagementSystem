import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from '../auth/permissions';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { requireTenantId, runUnscoped } from '../common/tenant-context';

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  appRole: true,
  permissions: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ProfileSelect;

/**
 * Staff accounts within one store.
 *
 * Two things changed here at once, and they are related. Accounts now live in
 * Supabase Auth, so this creates them through the admin API rather than writing
 * a password hash — a row written straight to the database would look like an
 * account in every list and be unable to sign in.
 *
 * And it is the Tenant Admin who manages them, not the platform owner. Every
 * query is tenant-scoped automatically, so "the users in this store" needs no
 * filter of its own; what the checks below add is the part scoping cannot
 * express — that nobody hands out a role above their own.
 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private supabase: SupabaseAdminService,
  ) {}

  /** The permission catalog and role defaults, so the UI never hardcodes them. */
  catalog() {
    return { permissions: ALL_PERMISSIONS, rolePermissions: ROLE_PERMISSIONS };
  }

  async findAll(query: { search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.ProfileWhereInput = {};
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);

    const [profiles, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: [{ appRole: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.profile.count({ where }),
    ]);

    return {
      /*
       * `role` on the wire is the store role the UI actually edits (MANAGER,
       * STAFF, …). The coarse tier is exposed separately as `profileRole`, so a
       * screen about staffing is not handed two fields both called "role" that
       * mean different things.
       */
      items: profiles.map((p) => ({
        ...p,
        name: p.fullName,
        role: p.appRole,
        profileRole: p.role,
        effectivePermissions: effectivePermissions(p.appRole, p.permissions),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * A store admin may create staff, not peers or superiors.
   *
   * SUPER_ADMIN is a platform role and can never be granted from inside a
   * store. ADMIN is withheld too: letting one admin mint another means a
   * compromised or disgruntled account can entrench itself, and the platform
   * owner is the right place for that decision.
   */
  private validate(role?: string, permissions?: string[]) {
    if (role === 'SUPER_ADMIN') {
      throw new ForbiddenException('The platform administrator role cannot be granted from within a store');
    }
    if (role === 'ADMIN') {
      throw new ForbiddenException('Only the platform administrator can appoint another store admin');
    }
    const unknown = (permissions ?? []).filter((p) => !ALL_PERMISSIONS.includes(p as any));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }

  /** Refuse a new account once the store is at the seat limit the platform set. */
  private async assertSeatAvailable(tenantId: string) {
    const tenant = await runUnscoped(() =>
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { maxUsers: true, name: true } }),
    );
    if (!tenant?.maxUsers) return;
    const used = await this.prisma.profile.count();
    if (used >= tenant.maxUsers) {
      throw new ForbiddenException(
        `${tenant.name} is limited to ${tenant.maxUsers} user account(s). Contact the platform administrator to raise it.`,
      );
    }
  }

  async create(
    actorId: string,
    dto: { email: string; name: string; password: string; role: string; permissions?: string[] },
  ) {
    this.validate(dto.role, dto.permissions);
    const tenantId = requireTenantId();
    await this.assertSeatAvailable(tenantId);

    const email = dto.email.trim().toLowerCase();
    // Email is unique platform-wide: one address is one person is one store.
    const taken = await runUnscoped(() =>
      this.prisma.profile.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
    );
    if (taken) throw new BadRequestException('An account with this email already exists');

    // Creating the auth account fires the signup trigger, which writes both the
    // profile and the "User" row. Nothing to insert here.
    const created = await this.supabase.createUser({
      email,
      password: dto.password,
      fullName: dto.name.trim(),
      role: 'staff',
      tenantId,
      appRole: dto.role,
      permissions: dto.permissions ?? [],
    });

    await this.audit.log(actorId, 'CREATE', 'Profile', created.id, { email, role: dto.role });
    return this.findOne(created.id);
  }

  async update(
    actorId: string,
    id: string,
    dto: { name?: string; role?: string; permissions?: string[]; isActive?: boolean; password?: string },
  ) {
    const target = await this.prisma.profile.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Account not found');
    if (target.role === 'super_admin') {
      throw new ForbiddenException('The platform administrator account cannot be changed here');
    }
    if (target.appRole === 'ADMIN' && target.id !== actorId) {
      throw new ForbiddenException('Only the platform administrator can change another store admin');
    }
    this.validate(dto.role, dto.permissions);
    if (dto.password !== undefined && dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const profile = await this.prisma.profile.update({
      where: { id },
      data: {
        fullName: dto.name?.trim(),
        appRole: dto.role,
        permissions: dto.permissions,
        isActive: dto.isActive,
      },
      select: SAFE_SELECT,
    });

    if (dto.password) await this.supabase.setPassword(id, dto.password);
    if (dto.isActive !== undefined) await this.supabase.setBanned(id, !dto.isActive).catch(() => undefined);

    /*
     * Role and permissions are signed into the access token, so a demotion is
     * advisory until the token is reissued. Ending the sessions makes it
     * immediate — the same reason the platform does this when it suspends a
     * store.
     */
    if (dto.role || dto.permissions || dto.isActive === false || dto.password) {
      await this.supabase.signOutEverywhere(id);
    }

    await this.audit.log(actorId, 'UPDATE', 'Profile', id, {
      role: dto.role,
      isActive: dto.isActive,
      passwordReset: !!dto.password,
    });
    return profile;
  }

  async remove(actorId: string, id: string) {
    const target = await this.prisma.profile.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Account not found');
    if (target.role === 'super_admin') throw new ForbiddenException('The platform administrator cannot be deleted');
    if (target.appRole === 'ADMIN') {
      throw new ForbiddenException('Only the platform administrator can remove a store admin');
    }
    if (target.id === actorId) throw new BadRequestException('You cannot delete your own account');

    /*
     * The sign-in goes; the "User" row stays, archived.
     *
     * Audit entries, orders and payments all reference the user who created
     * them. Deleting that row would either break those foreign keys or rewrite
     * history to say nobody made the sale.
     */
    await this.supabase.deleteUser(id);
    await this.prisma.user.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(actorId, 'DELETE', 'Profile', id, { email: target.email });
    return { success: true };
  }

  private async findOne(id: string) {
    const profile = await runUnscoped(() =>
      this.prisma.profile.findUnique({ where: { id }, select: SAFE_SELECT }),
    );
    if (!profile) throw new NotFoundException('Account not found');
    return {
      ...profile,
      name: profile.fullName,
      role: profile.appRole,
      profileRole: profile.role,
      effectivePermissions: effectivePermissions(profile.appRole, profile.permissions),
    };
  }
}
