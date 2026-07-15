import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(userId: string | null, action: string, entity: string, entityId?: string | number, details?: any) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        entity,
        entityId: entityId !== undefined ? String(entityId) : undefined,
        details: details ?? undefined,
      },
    });
  }
}
