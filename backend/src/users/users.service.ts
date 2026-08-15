import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from '../auth/permissions';

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  permissions: true,
  isActive: true,
  createdAt: true,
  lockedUntil: true,
} satisfies Prisma.UserSelect;

/**
 * Account management, reachable only by the super admin (enforced by the
 * @SuperAdminOnly decorator on the controller).
 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** The permission catalog and role defaults, so the UI never hardcodes them. */
  catalog() {
    return { permissions: ALL_PERMISSIONS, rolePermissions: ROLE_PERMISSIONS };
  }

  async findAll(query: { search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.user.count({ where });
    const users = await this.prisma.user.findMany({
      where,
      select: SAFE_SELECT,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: users.map((u) => ({ ...u, effectivePermissions: effectivePermissions(u.role, u.permissions) })),
      total: await totalPromise,
      page,
      pageSize,
    };
  }

  private validate(role?: string, permissions?: string[]) {
    if (role === 'SUPER_ADMIN') {
      // One owner. Promoting a second would create two accounts that can
      // demote each other, which is a support problem waiting to happen.
      throw new BadRequestException('There can only be one super admin');
    }
    const unknown = (permissions ?? []).filter((p) => !ALL_PERMISSIONS.includes(p as any));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }

  async create(actorId: string, dto: { email: string; name: string; password: string; role: string; permissions?: string[] }) {
    this.validate(dto.role, dto.permissions);
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('An account with this email already exists');
    if (dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role as any,
        permissions: dto.permissions ?? [],
      },
      select: SAFE_SELECT,
    });
    await this.audit.log(actorId, 'CREATE', 'User', user.id, { email, role: dto.role });
    return user;
  }

  async update(
    actorId: string,
    id: string,
    dto: { name?: string; role?: string; permissions?: string[]; isActive?: boolean; password?: string },
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.deletedAt) throw new NotFoundException('Account not found');
    if (target.role === 'SUPER_ADMIN') {
      // The super admin edits itself through the profile page; blocking it here
      // means the owner cannot accidentally demote or deactivate themselves and
      // lock everyone out of account management.
      throw new BadRequestException('The super admin account cannot be changed here');
    }
    this.validate(dto.role, dto.permissions);
    if (dto.password !== undefined && dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        role: dto.role as any,
        permissions: dto.permissions,
        isActive: dto.isActive,
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: SAFE_SELECT,
    });

    // A demoted or deactivated account must not keep working until its access
    // token happens to expire.
    if (dto.role || dto.isActive === false || dto.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.log(actorId, 'UPDATE', 'User', id, {
      role: dto.role,
      isActive: dto.isActive,
      passwordReset: !!dto.password,
    });
    return user;
  }

  async remove(actorId: string, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.deletedAt) throw new NotFoundException('Account not found');
    if (target.role === 'SUPER_ADMIN') throw new BadRequestException('The super admin account cannot be deleted');
    if (target.id === actorId) throw new BadRequestException('You cannot delete your own account');

    // Archived, not deleted: audit entries, orders and payments all reference
    // the user who created them, and those records must stay intact.
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(actorId, 'DELETE', 'User', id, { email: target.email });
    return { success: true };
  }
}
