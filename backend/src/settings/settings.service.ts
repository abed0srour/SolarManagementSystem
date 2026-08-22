import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { requireTenantId } from '../common/tenant-context';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getAll() {
    const settings = await this.prisma.setting.findMany();
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  }

  async set(userId: string, key: string, value: any) {
    // Settings are per store — one tenant's branding and currency are not
    // another's — so the key is only unique alongside the tenant.
    const setting = await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId: requireTenantId(), key } },
      update: { value },
      create: { key, value },
    });
    await this.audit.log(userId, 'UPDATE', 'Setting', key, value);
    return setting;
  }

  sequences() {
    return this.prisma.numberSequence.findMany({ orderBy: { entity: 'asc' } });
  }

  async updateSequence(userId: string, id: string, data: { prefix?: string; nextNumber?: number; padding?: number }) {
    const seq = await this.prisma.numberSequence.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'NumberSequence', id, data);
    return seq;
  }
}
