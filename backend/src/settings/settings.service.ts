import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

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
    const setting = await this.prisma.setting.upsert({
      where: { key },
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
