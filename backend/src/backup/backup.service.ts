import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { gunzipSync, createGzip } from 'zlib';
import JSZip from 'jszip';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../common/storage';
import { isServerless } from '../common/runtime';
import { requireTenantId, runAsTenant, runUnscoped } from '../common/tenant-context';

/**
 * Storage keys rather than paths: StorageService puts these on disk in
 * development and in Vercel Blob in production, so the backup feature works the
 * same on a laptop and on a platform with no writable filesystem.
 */
// One snapshot per store. These used to be two fixed paths, which under
// multi-tenancy would mean every store overwriting the previous one's backup —
// silent, and only discovered when someone needed to restore.
const LATEST_NAME = 'backup.json.gz';
const PREVIOUS_NAME = 'backup.previous.json.gz';

// Rows are streamed to disk in pages rather than loaded all at once, so a
// table that has grown huge after years of use never blows up process
// memory. createMany() batches stay well under Postgres' ~65535 bound-
// parameter limit even for wide tables.
const EXPORT_PAGE_SIZE = 2000;
const RESTORE_CHUNK_SIZE = 500;

// A full restore is a rare, large, high-stakes operation over a remote
// pooled connection — give it much more room than the app's normal
// transaction timeout (60s, tuned for interactive requests).
const RESTORE_TIMEOUT_MS = 10 * 60 * 1000;
const RESTORE_MAX_WAIT_MS = 30_000;

// Bump this only if the export shape changes in a way that would break
// restoring an older file. Lets old backups be refused cleanly instead of
// failing halfway through a restore, however many years later they're used.
const BACKUP_FORMAT_VERSION = 1;

const SCHEDULE_KEY = 'backup.schedule';
const CRON_JOB_NAME = 'scheduled-backup';

/** RFC 4180 quoting, plus the leading-BOM Excel needs to read UTF-8 correctly. */
function toCsv(rows: any[]): string {
  if (!rows.length) return '﻿';
  const columns = Object.keys(rows[0]);
  const cell = (v: any): string => {
    if (v === null || v === undefined) return '';
    // Dates as ISO, JSON columns as compact JSON; everything else as-is.
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

interface BackupSchedule {
  enabled: boolean;
  dayOfWeek: number; // 0 (Sunday) – 6 (Saturday)
  hour: number; // 0-23, server local time
  minute: number; // 0-59
}

const DEFAULT_SCHEDULE: BackupSchedule = { enabled: true, dayOfWeek: 0, hour: 3, minute: 0 };

/**
 * Never exported, and — far more importantly — never deleted by a restore.
 *
 * `BackupLog` is the backup system's own bookkeeping: restoring an old snapshot
 * must not undo how backups are configured or erase the run history on this
 * install.
 *
 * The rest are here because a restore begins by clearing the tables it is about
 * to refill, and these are not tenant-scoped. `Tenant` in particular has no
 * tenantId to filter on, so a single store restoring its own snapshot would
 * have issued an unfiltered `DELETE FROM "Tenant"` and cascaded away every
 * other customer on the platform. Identity tables are excluded for the same
 * class of reason: accounts live in `auth.users` now, and a snapshot cannot
 * meaningfully restore them.
 */
const EXCLUDED_MODELS = new Set([
  'BackupLog',
  'Tenant',
  'Profile',
  'User',
  'RefreshToken',
  'PasswordResetToken',
  'VerificationCode',
]);

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  /**
   * Which stores currently have a backup or restore in flight.
   *
   * A single boolean would have made one store's backup refuse every other
   * store's, which is a self-inflicted outage as soon as the platform has more
   * than a handful of customers.
   */
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private scheduler: SchedulerRegistry,
    private storage: StorageService,
  ) {}

  /** Storage key for the calling tenant. Keeps one store out of another's files. */
  private key(name: string): string {
    return `backups/${requireTenantId()}/${name}`;
  }

  async onModuleInit() {
    /*
     * One sweep for the whole platform, rather than one cron job per store.
     *
     * The schedule is a per-tenant setting, so the old approach — read "the"
     * schedule at boot and register a job for it — has no meaning once there is
     * more than one store, and it cannot pick up a store created afterwards.
     * An hourly sweep asks every active store whether it is due instead, which
     * is correct as stores come and go and costs one query an hour.
     */
    this.applySweep();
  }

  private applySweep() {
    // Serverless has no live process to run a timer; /api/cron/backup drives it.
    if (isServerless()) return;
    if (this.scheduler.doesExist('cron', CRON_JOB_NAME)) this.scheduler.deleteCronJob(CRON_JOB_NAME);
    const job = new CronJob('0 * * * *', () => {
      this.runDueBackups().catch((err) => this.logger.error(`Scheduled backup sweep failed: ${err.message}`));
    });
    this.scheduler.addCronJob(CRON_JOB_NAME, job);
    job.start();
  }

  /**
   * Back up every store that is due.
   *
   * Each one runs inside `runAsTenant`, so the export reads exactly the rows
   * that store owns — the same scoping its own users get. That is what makes a
   * per-tenant backup fall out of the design rather than needing a separate
   * implementation with its own filters to get wrong.
   */
  async runDueBackups(): Promise<{ checked: number; backedUp: string[] }> {
    const tenants = await runUnscoped(() =>
      this.prisma.tenant.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    );

    const backedUp: string[] = [];
    for (const tenant of tenants) {
      try {
        const due = await runAsTenant(tenant.id, () => this.isScheduledForNow());
        if (!due) continue;
        await runAsTenant(tenant.id, () => this.run('SCHEDULER'));
        backedUp.push(tenant.name);
      } catch (err: any) {
        // One store failing must not stop the rest of the platform being backed up.
        this.logger.error(`Backup failed for ${tenant.name}: ${err.message}`);
      }
    }
    return { checked: tenants.length, backedUp };
  }

  // ---- Schema-driven table order (parents before children) ----

  /** All current models in FK-dependency order, derived live from the Prisma
   *  schema (DMMF) — never needs hand-maintaining as models are added over
   *  the system's lifetime. Each entry carries its actual primary-key field
   *  name — always "id" now that Setting has a surrogate key. */
  private modelOrder(): { name: string; idField: string }[] {
    const models = Prisma.dmmf.datamodel.models.filter((m) => !EXCLUDED_MODELS.has(m.name));
    const deps = new Map<string, Set<string>>();
    const idFieldByName = new Map<string, string>();
    for (const m of models) {
      const set = new Set<string>();
      for (const f of m.fields) {
        if (f.kind === 'object' && f.relationFromFields?.length && f.type !== m.name) set.add(f.type);
        if (f.isId) idFieldByName.set(m.name, f.name);
      }
      deps.set(m.name, set);
    }
    const known = new Set(models.map((m) => m.name));
    const order: string[] = [];
    const done = new Set<string>();
    const inStack = new Set<string>();
    const visit = (name: string) => {
      if (done.has(name) || !known.has(name)) return;
      if (inStack.has(name)) return; // defensive: this schema has no relation cycles
      inStack.add(name);
      for (const dep of deps.get(name) ?? []) visit(dep);
      inStack.delete(name);
      done.add(name);
      order.push(name);
    };
    for (const m of models) visit(m.name);
    return order.map((name) => ({ name, idField: idFieldByName.get(name)! }));
  }

  private delegate(client: any, modelName: string) {
    const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    return client[key];
  }

  // ---- CSV export ----

  /**
   * Every table as a CSV inside one zip.
   *
   * Separate from `run()` on purpose: that produces a gzipped JSON snapshot
   * built for restoring — exact types, relation order, nothing lost. This is
   * built for a human opening it in Excel, so values are flattened to text and
   * nothing about it is restorable. Keeping the two apart means neither has to
   * compromise for the other.
   */
  async csvExport(): Promise<Buffer> {
    const zip = new JSZip();
    const stamp = new Date().toISOString().slice(0, 10);
    for (const { name, idField } of this.modelOrder()) {
      const delegate = this.delegate(this.prisma, name);
      const rows: any[] = [];
      let cursor: any;
      // Same paged read as the JSON backup: never hold a whole table at once.
      for (;;) {
        const page = await delegate.findMany({
          take: EXPORT_PAGE_SIZE,
          orderBy: { [idField]: 'asc' },
          ...(cursor ? { cursor: { [idField]: cursor }, skip: 1 } : {}),
        });
        if (!page.length) break;
        rows.push(...page);
        cursor = page[page.length - 1][idField];
        if (page.length < EXPORT_PAGE_SIZE) break;
      }
      zip.file(`${name}.csv`, toCsv(rows));
    }
    zip.file(
      'README.txt',
      `Solar Store CSV export — ${stamp}\n\n` +
        `One CSV per table. This is a readable export for spreadsheets, not a restorable backup;\n` +
        `use Settings > Backup for a snapshot that can be restored.\n`,
    );
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  // ---- Backup ----

  async run(triggeredBy: string) {
    const tenantId = requireTenantId();
    if (this.running.has(tenantId)) throw new BadRequestException('A backup is already running');
    this.running.add(tenantId);
    const start = Date.now();
    const order = this.modelOrder();
    let rowCount = 0;
    try {
      // Compressed chunks are collected in memory instead of streamed to a
      // file. Rows are still read a page at a time, so what accumulates here is
      // only the gzipped output — a fraction of the database's size.
      const gzip = createGzip();
      const chunks: Buffer[] = [];
      gzip.on('data', (c: Buffer) => chunks.push(c));
      const donePromise = new Promise<void>((resolve, reject) => {
        gzip.on('end', () => resolve());
        gzip.on('error', reject);
      });
      gzip.write(`{"meta":${JSON.stringify({ version: BACKUP_FORMAT_VERSION, createdAt: new Date().toISOString() })},"data":{`);
      for (let i = 0; i < order.length; i++) {
        const { name, idField } = order[i];
        const delegate = this.delegate(this.prisma, name);
        gzip.write(`${JSON.stringify(name)}:[`);
        let cursor: any;
        let wroteAny = false;
        for (;;) {
          const rows: any[] = await delegate.findMany({
            take: EXPORT_PAGE_SIZE,
            ...(cursor !== undefined ? { skip: 1, cursor: { [idField]: cursor } } : {}),
            orderBy: { [idField]: 'asc' },
          });
          if (rows.length === 0) break;
          for (const row of rows) {
            gzip.write(wroteAny ? ',' : '');
            gzip.write(JSON.stringify(row));
            wroteAny = true;
          }
          rowCount += rows.length;
          cursor = rows[rows.length - 1][idField];
          if (rows.length < EXPORT_PAGE_SIZE) break;
        }
        gzip.write(i === order.length - 1 ? ']' : '],');
      }
      gzip.write('}}');
      gzip.end();
      await donePromise;

      // Overwrite in place, keeping exactly one prior generation as a safety
      // net against a corrupted/interrupted run — never more than two objects
      // stored, which is the spirit of "replace the old backup".
      //
      // The rotation happens only after the new archive is fully built: if the
      // export throws, the existing backup is still the one in storage.
      const body = Buffer.concat(chunks);
      await this.storage.copy(this.key(LATEST_NAME), this.key(PREVIOUS_NAME));
      const stored = await this.storage.put(this.key(LATEST_NAME), body, 'application/gzip');

      const sizeBytes = stored.size;
      await this.prisma.backupLog.create({
        data: {
          type: 'BACKUP',
          status: 'SUCCESS',
          filename: 'backup.json.gz',
          sizeBytes,
          tableCount: order.length,
          rowCount,
          triggeredBy,
          durationMs: Date.now() - start,
        },
      });
      await this.audit.log(triggeredBy === 'SCHEDULER' ? null : triggeredBy, 'BACKUP', 'System', undefined, { rowCount, sizeBytes });
      await this.pruneHistory();
      this.logger.log(`Backup complete: ${order.length} tables, ${rowCount} rows, ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
      return { success: true, sizeBytes, rowCount, tableCount: order.length };
    } catch (err: any) {
      await this.prisma.backupLog
        .create({ data: { type: 'BACKUP', status: 'FAILED', error: String(err.message ?? err).slice(0, 1000), triggeredBy, durationMs: Date.now() - start } })
        .catch(() => {});
      this.logger.error(`Backup failed: ${err.message}`);
      throw err;
    } finally {
      this.running.delete(tenantId);
    }
  }

  /** Cap the run-history table so it stays small forever — a weekly cadence
   *  for 3 years is only ~150 rows, so this rarely does anything. */
  private async pruneHistory() {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 3);
    await this.prisma.backupLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  // ---- Status ----

  async status() {
    const [lastBackup, lastRestore, history, schedule] = await Promise.all([
      this.prisma.backupLog.findFirst({ where: { type: 'BACKUP', status: 'SUCCESS' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.backupLog.findFirst({ where: { type: 'RESTORE', status: 'SUCCESS' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.backupLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.getSchedule(),
    ]);
    const hasLocalFile = !!(await this.storage.stat(this.key(LATEST_NAME)));
    return { lastBackup, lastRestore, history, schedule, hasLocalFile };
  }

  // ---- Schedule ----

  /**
   * Should the platform scheduler take a backup on this invocation?
   *
   * A hosted cron fires on a fixed timetable, but the admin configures their own
   * weekly day here. So the day is checked against their setting, while the hour
   * is left to whatever cadence the platform runs at — and a 12-hour cooldown
   * keeps an hourly scheduler from taking 24 backups on the chosen day.
   */
  async isScheduledForNow(now = new Date()): Promise<boolean> {
    const schedule = await this.getSchedule();
    if (!schedule.enabled) return false;
    if (now.getDay() !== schedule.dayOfWeek) return false;
    const last = await this.prisma.backupLog.findFirst({
      where: { type: 'BACKUP', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return true;
    return now.getTime() - last.createdAt.getTime() > 12 * 3600 * 1000;
  }

  async getSchedule(): Promise<BackupSchedule> {
    const row = await this.prisma.setting.findFirst({ where: { key: SCHEDULE_KEY } });
    return { ...DEFAULT_SCHEDULE, ...((row?.value as any) ?? {}) };
  }

  async setSchedule(userId: string, dto: Partial<BackupSchedule>) {
    const current = await this.getSchedule();
    const next: BackupSchedule = {
      enabled: dto.enabled ?? current.enabled,
      dayOfWeek: dto.dayOfWeek ?? current.dayOfWeek,
      hour: dto.hour ?? current.hour,
      minute: dto.minute ?? current.minute,
    };
    if (next.dayOfWeek < 0 || next.dayOfWeek > 6) throw new BadRequestException('dayOfWeek must be 0-6');
    if (next.hour < 0 || next.hour > 23) throw new BadRequestException('hour must be 0-23');
    if (next.minute < 0 || next.minute > 59) throw new BadRequestException('minute must be 0-59');

    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId: requireTenantId(), key: SCHEDULE_KEY } },
      update: { value: next as any },
      create: { key: SCHEDULE_KEY, value: next as any },
    });
    await this.audit.log(userId, 'UPDATE', 'BackupSchedule', undefined, next);
    // No cron job to re-register: the hourly sweep re-reads this on its next pass.
    return next;
  }

  // ---- Download ----

  /**
   * The archive bytes to send to the browser.
   *
   * Returns a buffer rather than a path because in production the file lives in
   * blob storage and has no path on this machine.
   */
  async downloadBody(): Promise<Buffer> {
    const buffer = await this.storage.get(this.key(LATEST_NAME));
    if (!buffer) throw new BadRequestException('No backup has been taken yet');
    return buffer;
  }

  // ---- Restore ----

  async restoreFromLocal(userId: string) {
    const buffer = await this.storage.get(this.key(LATEST_NAME));
    if (!buffer) throw new BadRequestException('No stored backup to restore from');
    return this.restoreFromBuffer(userId, buffer);
  }

  async restoreFromBuffer(userId: string, buffer: Buffer) {
    const tenantId = requireTenantId();
    if (this.running.has(tenantId)) throw new BadRequestException('A backup or restore is already running');
    this.running.add(tenantId);
    const start = Date.now();
    let parsed: any;
    try {
      const json = gunzipSync(buffer).toString('utf8');
      parsed = JSON.parse(json);
    } catch {
      this.running.delete(tenantId);
      throw new BadRequestException('Not a valid backup file (expected a .json.gz export from this system)');
    }
    if (!parsed?.data || typeof parsed.meta?.version !== 'number') {
      this.running.delete(tenantId);
      throw new BadRequestException('Not a valid backup file');
    }
    if (parsed.meta.version > BACKUP_FORMAT_VERSION) {
      this.running.delete(tenantId);
      throw new BadRequestException('This backup was made by a newer version of the system and cannot be restored here — update the app first');
    }

    const order = this.modelOrder();
    let rowCount = 0;
    let tableCount = 0;
    try {
      // This install's own backup schedule must survive restoring someone
      // else's (or an older) snapshot.
      const preservedSettings = await this.prisma.setting.findMany({ where: { key: { startsWith: 'backup.' } } });

      await this.prisma.$transaction(
        async (tx) => {
          // Children before parents so FK constraints never block a delete.
          for (const { name } of [...order].reverse()) {
            await this.delegate(tx, name).deleteMany({});
          }
          // Parents before children for insert.
          for (const { name } of order) {
            const rows: any[] = parsed.data[name] ?? [];
            if (!rows.length) continue;
            tableCount++;
            const delegate = this.delegate(tx, name);
            for (let i = 0; i < rows.length; i += RESTORE_CHUNK_SIZE) {
              const chunk = rows.slice(i, i + RESTORE_CHUNK_SIZE);
              await delegate.createMany({ data: chunk, skipDuplicates: true });
              rowCount += chunk.length;
            }
          }
          for (const s of preservedSettings) {
            await tx.setting.upsert({
              where: { tenantId_key: { tenantId: requireTenantId(), key: s.key } },
              update: { value: s.value as any },
              create: { key: s.key, value: s.value as any },
            });
          }
        },
        { timeout: RESTORE_TIMEOUT_MS, maxWait: RESTORE_MAX_WAIT_MS },
      );

      await this.prisma.backupLog.create({
        data: { type: 'RESTORE', status: 'SUCCESS', tableCount, rowCount, triggeredBy: userId, durationMs: Date.now() - start },
      });
      await this.audit.log(userId, 'RESTORE', 'System', undefined, { rowCount, tableCount });
      this.logger.warn(`Restore complete: ${tableCount} tables, ${rowCount} rows restored by ${userId}`);
      return { success: true, rowCount, tableCount };
    } catch (err: any) {
      await this.prisma.backupLog
        .create({ data: { type: 'RESTORE', status: 'FAILED', error: String(err.message ?? err).slice(0, 1000), triggeredBy: userId, durationMs: Date.now() - start } })
        .catch(() => {});
      this.logger.error(`Restore failed: ${err.message}`);
      throw err;
    } finally {
      this.running.delete(tenantId);
    }
  }
}
