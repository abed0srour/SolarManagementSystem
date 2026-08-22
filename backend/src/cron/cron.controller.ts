import { Controller, ForbiddenException, Get, Headers, Logger, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { BackupService } from '../backup/backup.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * HTTP entry points for the scheduled work.
 *
 * On a long-running server the `@Cron` decorators fire these themselves. A
 * serverless deployment has no process alive between requests, so nothing would
 * ever run — the platform's scheduler calls these URLs instead, and the same
 * service methods do the same work.
 *
 * The endpoints are public to the JWT guard because a platform scheduler cannot
 * hold a user session; they are protected by a shared secret instead. Vercel
 * sends `Authorization: Bearer $CRON_SECRET` on every cron invocation.
 */
@ApiExcludeController()
@Controller('cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(
    private notifications: NotificationsService,
    private maintenance: MaintenanceService,
    private backup: BackupService,
  ) {}

  /**
   * Constant-time comparison against CRON_SECRET.
   *
   * Refusing outright when the secret is unset matters: otherwise a
   * misconfigured deployment would expose endpoints that rewrite data to anyone
   * who guesses the path.
   */
  private authorise(header?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new ForbiddenException('CRON_SECRET is not configured');
    const provided = (header ?? '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Invalid cron secret');
  }

  @Public()
  @Get(':job')
  async run(@Param('job') job: string, @Headers('authorization') auth?: string) {
    this.authorise(auth);
    const started = Date.now();

    switch (job) {
      case 'notifications':
        await this.notifications.runChecks();
        break;
      case 'maintenance':
        await this.maintenance.dailyChecks();
        break;
      case 'backup': {
        // Honours each store's configured cadence: the platform scheduler can
        // only fire on a fixed timetable, so the job itself decides which
        // stores want a backup right now.
        const result = await this.backup.runDueBackups();
        return { job, ok: true, ...result, durationMs: Date.now() - started };
      }

      /*
       * Maintenance and backup in one call.
       *
       * Vercel's Hobby plan allows only two cron jobs, so the default
       * deployment pairs this with `notifications` to stay inside that limit.
       * On a plan with room, schedule the individual jobs instead.
       */
      case 'daily': {
        const maintenance = await this.maintenance.dailyChecks();
        const backup = await this.backup.runDueBackups();
        return { job, ok: true, maintenance, backup, durationMs: Date.now() - started };
      }
      default:
        throw new ForbiddenException(`Unknown job: ${job}`);
    }

    const ms = Date.now() - started;
    this.logger.log(`Cron job "${job}" finished in ${ms}ms`);
    return { job, ok: true, durationMs: ms };
  }
}
