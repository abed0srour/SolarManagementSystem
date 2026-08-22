import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runAsTenant, runUnscoped } from './tenant-context';

/**
 * Runs a job once per active store.
 *
 * Scheduled work has no request behind it, and therefore no tenant — which
 * under the scoping extension means it is refused outright rather than quietly
 * sweeping every store at once. That refusal is the point: "check for low
 * stock" has no answer across all tenants, only an answer per tenant. This
 * turns a job into the loop it always implicitly was, and runs each pass inside
 * the same scoping a real user gets, so a cron job cannot see more than the
 * store it is working on.
 */
@Injectable()
export class TenantSweepService {
  private readonly logger = new Logger(TenantSweepService.name);

  constructor(private prisma: PrismaService) {}

  async forEachActiveTenant(
    label: string,
    job: (tenant: { id: string; name: string }) => Promise<void>,
  ): Promise<{ tenants: number; failed: number }> {
    const tenants = await runUnscoped(() =>
      this.prisma.tenant.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
    );

    let failed = 0;
    for (const tenant of tenants) {
      try {
        await runAsTenant(tenant.id, () => job(tenant));
      } catch (err: any) {
        // One bad store must not stop the sweep for everyone else.
        failed++;
        this.logger.error(`${label} failed for ${tenant.name}: ${err.message}`);
      }
    }
    return { tenants: tenants.length, failed };
  }
}
