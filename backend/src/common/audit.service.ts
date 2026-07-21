import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Fire-and-forget by design: every caller invokes this AFTER its real
   * business transaction has already committed, purely to leave a trail.
   * If this write hits a transient hiccup (e.g. a dropped pooled DB
   * connection), the action itself already succeeded — letting that
   * failure propagate would report a successful confirm/save/pay as an
   * error to the user even though nothing needs retrying. So it never
   * throws; a failure here is logged and swallowed instead.
   */
  async log(userId: string | null, action: string, entity: string, entityId?: string | number, details?: any) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId ?? undefined,
          action,
          entity,
          entityId: entityId !== undefined ? String(entityId) : undefined,
          details: details ?? undefined,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Audit log write failed for ${action} ${entity}${entityId ? ` #${entityId}` : ''}: ${err.message}`);
    }
  }
}
