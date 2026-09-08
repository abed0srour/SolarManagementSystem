import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { requireTenantId } from '../common/tenant-context';
import { SerialFormatRule } from '../inventory/serial-container';

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

  /**
   * How this tenant wants a scanned/typed serial reshaped before it is stored
   * or looked up. Read directly rather than through `getAll()` so the hot
   * serial-capture paths (goods receipt, sales-order scan) don't pay for every
   * other setting on each call. Defaults to "no rule" — trim-only, today's
   * behaviour — until the tenant configures one.
   */
  async getSerialFormat(client: { setting: { findUnique: (args: any) => Promise<{ value: unknown } | null> } } = this.prisma): Promise<SerialFormatRule | null> {
    const row = await client.setting.findUnique({
      where: { tenantId_key: { tenantId: requireTenantId(), key: 'serialFormat' } },
    });
    return (row?.value as SerialFormatRule) ?? null;
  }

  async set(userId: string, key: string, value: any) {
    // Settings are per store — one tenant's branding and currency are not
    // another's — so the key is only unique alongside the tenant.
    const setting = await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId: requireTenantId(), key } },
      update: { value },
      create: { key, value },
    });
    if (key === 'company' && value && typeof value === 'object' && value.name) {
      await this.prisma.tenant
        .update({
          where: { id: requireTenantId() },
          data: { name: String(value.name) },
        })
        .catch(() => {});
    }
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
