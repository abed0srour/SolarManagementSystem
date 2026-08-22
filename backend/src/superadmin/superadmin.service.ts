import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { runAsTenant, runUnscoped } from '../common/tenant-context';

export interface CreateTenantDto {
  name: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
  adminPassword?: string;
  contactPhone?: string;
  notes?: string;
  maxUsers?: number;
  maxProducts?: number;
  maxClients?: number;
  expiresAt?: string;
  /** Send an invite email instead of setting a password now. */
  invite?: boolean;
}

/** Document numbering every new store starts with. */
const DEFAULT_SEQUENCES: { entity: string; prefix: string }[] = [
  { entity: 'INVOICE', prefix: 'INV-' },
  { entity: 'QUOTATION', prefix: 'QUO-' },
  { entity: 'SALES_ORDER', prefix: 'SO-' },
  { entity: 'PURCHASE_ORDER', prefix: 'PO-' },
  { entity: 'PAYMENT', prefix: 'PAY-' },
  { entity: 'REFUND', prefix: 'REF-' },
  { entity: 'CLAIM', prefix: 'WC-' },
  { entity: 'JOB', prefix: 'JOB-' },
  { entity: 'SUPPLIER_RETURN', prefix: 'SR-' },
  { entity: 'INSTALLATION', prefix: 'INS-' },
  { entity: 'CONTRACT', prefix: 'MC-' },
  { entity: 'EXPENSE', prefix: 'EXP-' },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Platform administration: the stores themselves, rather than anything inside
 * one.
 *
 * Every method here runs `runUnscoped` deliberately. The super admin has no
 * tenant of its own, so the ambient scoping that protects every other request
 * has nothing to filter on; stepping outside it is spelled out at each call
 * site so it is obvious in review which queries cross the boundary and why.
 */
@Injectable()
export class SuperadminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private supabase: SupabaseAdminService,
  ) {}

  // ---- Tenants ----

  async findAll(query: { search?: string; status?: string; includeArchived?: string }) {
    return runUnscoped(async () => {
      const where: Prisma.TenantWhereInput = {};
      if (query.includeArchived !== 'true') where.deletedAt = null;
      if (query.status) where.status = query.status as TenantStatus;
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { slug: { contains: query.search, mode: 'insensitive' } },
          { contactEmail: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const tenants = await this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { profiles: true, clients: true, products: true, invoices: true } } },
      });

      return tenants.map((t) => ({
        ...t,
        counts: {
          users: t._count.profiles,
          clients: t._count.clients,
          products: t._count.products,
          invoices: t._count.invoices,
        },
        _count: undefined,
      }));
    });
  }

  async findOne(id: string) {
    return runUnscoped(async () => {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id },
        include: {
          profiles: {
            select: { id: true, email: true, fullName: true, role: true, appRole: true, isActive: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!tenant) throw new NotFoundException('Store not found');
      return tenant;
    });
  }

  /**
   * Per-store totals for the dashboard.
   *
   * Counted through `runAsTenant` rather than a bespoke unscoped query with a
   * hand-written `WHERE tenantId = ...`. Same code path as the store itself
   * uses, so the number the platform sees cannot drift away from the number the
   * customer sees.
   */
  async stats(id: string) {
    const tenant = await this.findOne(id);
    const counts = await runAsTenant(id, async () => {
      const [clients, products, invoices, salesOrders, revenue] = await Promise.all([
        this.prisma.client.count({ where: { deletedAt: null } }),
        this.prisma.product.count({ where: { deletedAt: null } }),
        this.prisma.invoice.count({ where: { deletedAt: null } }),
        this.prisma.salesOrder.count({ where: { deletedAt: null } }),
        this.prisma.invoice.aggregate({
          where: { deletedAt: null, type: 'SALE', status: { not: 'CANCELLED' } },
          _sum: { total: true, paidAmount: true },
        }),
      ]);
      return {
        clients,
        products,
        invoices,
        salesOrders,
        billedTotal: Number(revenue._sum.total ?? 0),
        paidTotal: Number(revenue._sum.paidAmount ?? 0),
      };
    });
    return { tenant, counts };
  }

  /** Platform-wide totals for the super admin landing page. */
  async overview() {
    return runUnscoped(async () => {
      const [total, active, suspended, archived, users, recent] = await Promise.all([
        this.prisma.tenant.count({ where: { deletedAt: null } }),
        this.prisma.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.tenant.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
        this.prisma.tenant.count({ where: { deletedAt: null, status: 'ARCHIVED' } }),
        this.prisma.profile.count({ where: { role: { not: 'super_admin' } } }),
        this.prisma.tenant.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, name: true, slug: true, status: true, createdAt: true },
        }),
      ]);
      return { tenants: { total, active, suspended, archived }, users, recent };
    });
  }

  /**
   * Provision a store and its first admin in one step.
   *
   * Ordering matters and is not arbitrary. The tenant row and its starting data
   * are committed first, in one transaction; the Supabase account is created
   * only afterwards. Doing it the other way round would leave an account whose
   * `tenant_id` points at a store that never got created if the transaction
   * rolled back — an account that can sign in and then fails on every request.
   * If account creation fails here instead, the store exists with no members,
   * which the dashboard shows plainly and the platform owner can retry.
   */
  async createTenant(actorId: string, dto: CreateTenantDto) {
    const name = dto.name?.trim();
    const adminEmail = dto.adminEmail?.trim().toLowerCase();
    if (!name) throw new BadRequestException('Store name is required');
    if (!adminEmail) throw new BadRequestException('Admin email is required');
    if (!dto.invite && !dto.adminPassword) {
      throw new BadRequestException('Set an initial password, or choose to send an invite instead');
    }
    if (dto.adminPassword && dto.adminPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    // Check both local profiles and Supabase auth accounts before creating store
    const existingAuth = await this.supabase.findByEmail(adminEmail).catch(() => null);
    if (existingAuth) {
      throw new ConflictException(`An account with email "${adminEmail}" already exists. Please use a different email or delete the existing account first.`);
    }

    const tenant = await runUnscoped(async () => {
      const slug = await this.uniqueSlug(dto.slug?.trim() || name);

      const existingAccount = await this.prisma.profile.findFirst({
        where: { email: { equals: adminEmail, mode: 'insensitive' } },
      });
      if (existingAccount) {
        throw new ConflictException(`An account with email "${adminEmail}" already exists`);
      }

      return this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name,
            slug,
            contactEmail: adminEmail,
            contactPhone: dto.contactPhone?.trim() || null,
            notes: dto.notes?.trim() || null,
            maxUsers: dto.maxUsers ?? null,
            maxProducts: dto.maxProducts ?? null,
            maxClients: dto.maxClients ?? null,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
        });

        // A store with no document numbering cannot issue an invoice, so the
        // sequences are part of creating it rather than something to set up
        // later. tenantId is explicit here because this transaction runs
        // unscoped -- there is no ambient tenant to inherit.
        await tx.numberSequence.createMany({
          data: DEFAULT_SEQUENCES.map((s) => ({ ...s, tenantId: created.id })),
        });
        await tx.warehouse.create({
          data: { tenantId: created.id, name: 'Main Warehouse', isDefault: true },
        });
        await tx.setting.createMany({
          data: [
            { tenantId: created.id, key: 'company', value: { name } as any },
            { tenantId: created.id, key: 'finance', value: { currency: 'USD' } as any },
          ],
        });

        return created;
      });
    });

    let admin;
    try {
      const input = {
        email: adminEmail,
        password: dto.adminPassword,
        fullName: dto.adminName?.trim() || adminEmail,
        role: 'tenant_admin',
        tenantId: tenant.id,
        appRole: 'ADMIN',
        permissions: [] as string[],
      };
      admin = dto.invite
        ? await this.supabase.inviteUser(input, `${process.env.APP_URL ?? ''}/reset-password`)
        : await this.supabase.createUser(input);
    } catch (err) {
      // Clean up the created tenant so no empty phantom store is left behind
      await runUnscoped(async () => {
        await this.prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      });
      await this.audit.log(actorId, 'CREATE_TENANT_ADMIN_FAILED', 'Tenant', tenant.id, {
        email: adminEmail,
        error: (err as Error).message,
      });
      throw err;
    }

    await this.audit.log(actorId, 'CREATE', 'Tenant', tenant.id, { name, slug: tenant.slug, adminEmail });
    return { tenant, admin: { id: admin.id, email: admin.email }, invited: !!dto.invite };
  }

  async updateTenant(
    actorId: string,
    id: string,
    dto: Partial<Pick<CreateTenantDto, 'name' | 'notes' | 'contactPhone' | 'maxUsers' | 'maxProducts' | 'maxClients' | 'expiresAt'>>,
  ) {
    return runUnscoped(async () => {
      await this.assertExists(id);
      const tenant = await this.prisma.tenant.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          notes: dto.notes?.trim(),
          contactPhone: dto.contactPhone?.trim(),
          maxUsers: dto.maxUsers,
          maxProducts: dto.maxProducts,
          maxClients: dto.maxClients,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        },
      });
      await this.audit.log(actorId, 'UPDATE', 'Tenant', id, dto as any);
      return tenant;
    });
  }

  /**
   * Suspend or reactivate a store.
   *
   * Flipping the status is not enough on its own. Role and tenant status are
   * signed into each access token, so a member who is already signed in would
   * keep working for up to an hour on a token issued before the suspension.
   * Every session for every member is therefore revoked here, and the accounts
   * are banned in Supabase so a refresh cannot mint a new one.
   */
  async setStatus(actorId: string, id: string, status: TenantStatus, reason?: string) {
    const tenant = await runUnscoped(async () => {
      await this.assertExists(id);
      return this.prisma.tenant.update({
        where: { id },
        data: {
          status,
          suspendedAt: status === 'ACTIVE' ? null : new Date(),
          suspendedReason: status === 'ACTIVE' ? null : (reason?.trim() ?? null),
        },
      });
    });

    const members = await runUnscoped(() =>
      this.prisma.profile.findMany({ where: { tenantId: id }, select: { id: true } }),
    );
    const blocked = status !== 'ACTIVE';
    for (const member of members) {
      await this.supabase.setBanned(member.id, blocked).catch(() => undefined);
      await this.supabase.signOutEverywhere(member.id);
    }

    await this.audit.log(actorId, blocked ? 'SUSPEND' : 'ACTIVATE', 'Tenant', id, {
      status,
      reason,
      members: members.length,
    });
    return tenant;
  }

  /**
   * Archive a store.
   *
   * Soft delete only. The business records underneath are financial history —
   * invoices, payments, warranty claims that may still be honoured — so they
   * are kept and simply made unreachable. Hard deletion would cascade through
   * forty tables and is not something a dashboard button should be able to do.
   */
  async archiveTenant(actorId: string, id: string) {
    await this.setStatus(actorId, id, 'ARCHIVED', 'Archived by the platform administrator');
    const tenant = await runUnscoped(() =>
      this.prisma.tenant.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log(actorId, 'ARCHIVE', 'Tenant', id, {});
    return tenant;
  }

  async restoreTenant(actorId: string, id: string) {
    const tenant = await runUnscoped(() =>
      this.prisma.tenant.update({ where: { id }, data: { deletedAt: null } }),
    );
    await this.setStatus(actorId, id, 'ACTIVE');
    await this.audit.log(actorId, 'RESTORE', 'Tenant', id, {});
    return tenant;
  }

  // ---- Accounts inside a store ----

  /** Reset a member's password on their behalf (support path). */
  async resetMemberPassword(actorId: string, tenantId: string, userId: string, password: string) {
    await this.assertMember(tenantId, userId);
    await this.supabase.setPassword(userId, password);
    await this.supabase.signOutEverywhere(userId);
    await this.audit.log(actorId, 'RESET_PASSWORD', 'Profile', userId, { tenantId });
    return { success: true };
  }

  async setMemberActive(actorId: string, tenantId: string, userId: string, isActive: boolean) {
    await this.assertMember(tenantId, userId);
    await runUnscoped(() => this.prisma.profile.update({ where: { id: userId }, data: { isActive } }));
    await this.supabase.setBanned(userId, !isActive).catch(() => undefined);
    await this.supabase.signOutEverywhere(userId);
    await this.audit.log(actorId, isActive ? 'ACTIVATE' : 'DEACTIVATE', 'Profile', userId, { tenantId });
    return { success: true };
  }

  async deleteMember(actorId: string, tenantId: string, userId: string) {
    await this.assertMember(tenantId, userId);
    // Deleting the auth account cascades to `profiles`. The `"User"` row is
    // left behind on purpose: invoices, orders and audit entries point at it,
    // and detaching them would rewrite history.
    await this.supabase.deleteUser(userId);
    await runUnscoped(() =>
      this.prisma.user.updateMany({ where: { id: userId }, data: { isActive: false, deletedAt: new Date() } }),
    );
    await this.audit.log(actorId, 'DELETE', 'Profile', userId, { tenantId });
    return { success: true };
  }

  // ---- helpers ----

  private async assertExists(id: string) {
    const found = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Store not found');
  }

  private async assertMember(tenantId: string, userId: string) {
    const profile = await runUnscoped(() =>
      this.prisma.profile.findUnique({ where: { id: userId }, select: { tenantId: true } }),
    );
    if (!profile || profile.tenantId !== tenantId) throw new NotFoundException('Account not found in this store');
  }

  private async uniqueSlug(source: string): Promise<string> {
    const base = slugify(source) || 'store';
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await this.prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    throw new ConflictException('Could not derive a unique handle for this store name');
  }
}
