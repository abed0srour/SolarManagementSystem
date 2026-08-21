import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { round2 } from '../common/calc';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';

/** Midnight local, so a date compares cleanly against a `@db.Date` column. */
function dayOnly(value: string | Date): Date {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

@Injectable()
export class WorkersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(query: { search?: string; archived?: string; page?: number; pageSize?: number }) {
    const where: Prisma.WorkerWhereInput =
      query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { jobTitle: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const [items, total] = await Promise.all([
      this.prisma.worker.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.worker.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException('Worker not found');
    return worker;
  }

  /** Sequential staff code (W-001) so workers are identifiable without a UUID. */
  private async nextCode(): Promise<string> {
    const last = await this.prisma.worker.findFirst({
      where: { code: { startsWith: 'W-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const n = last ? Number(last.code.slice(2)) + 1 : 1;
    return `W-${String(n).padStart(3, '0')}`;
  }

  async create(userId: string, data: any) {
    const worker = await this.prisma.worker.create({
      data: {
        code: data.code?.trim() || (await this.nextCode()),
        name: data.name,
        phone: data.phone,
        email: data.email,
        jobTitle: data.jobTitle,
        payBasis: data.payBasis ?? 'DAILY',
        dailyRate: data.dailyRate ?? 0,
        hourlyRate: data.hourlyRate ?? 0,
        expectedHoursPerDay: data.expectedHoursPerDay ?? 8,
        lateDeductionPerHour: data.lateDeductionPerHour ?? 0,
        payPeriod: data.payPeriod ?? 'MONTHLY',
        hiredOn: data.hiredOn ? new Date(data.hiredOn) : undefined,
        notes: data.notes,
      },
    });
    await this.audit.log(userId, 'CREATE', 'Worker', worker.id, { name: worker.name, code: worker.code });
    return worker;
  }

  async update(userId: string, id: string, data: any) {
    const worker = await this.prisma.worker.update({
      where: { id },
      data: { ...data, hiredOn: data.hiredOn ? new Date(data.hiredOn) : undefined },
    });
    await this.audit.log(userId, 'UPDATE', 'Worker', id);
    return worker;
  }

  private async workerUsage(id: string) {
    const attendance = await this.prisma.attendanceEntry.count({ where: { workerId: id } });
    return { attendance };
  }

  async usage(id: string): Promise<UsageReport> {
    const counts = await this.workerUsage(id);
    return { used: !isUnused(counts), usedBy: usedBy(counts) };
  }

  /** Purge a worker with no attendance history. */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException('Worker not found');

    const counts = await this.workerUsage(id);
    if (!isUnused(counts)) {
      const used = usedBy(counts);
      const parts: string[] = [];
      if (used.attendance) parts.push(`${used.attendance} attendance record(s)`);
      const details = parts.length > 0 ? parts.join(', ') : 'linked records';
      throw new BadRequestException(
        `Cannot delete worker "${worker.name}" because they have existing relations (${details}).`,
      );
    }
    await this.prisma.worker.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'Worker', id);
    return { success: true, mode: 'PURGED', usedBy: {} };
  }

  async restore(userId: string, id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException('Worker not found');
    if (!worker.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.worker.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Worker', id);
    return { success: true, alreadyActive: false };
  }

  // ---- Attendance ----

  attendance(workerId: string, from?: string, to?: string) {
    return this.prisma.attendanceEntry.findMany({
      where: {
        workerId,
        ...(from || to
          ? { date: { ...(from ? { gte: dayOnly(from) } : {}), ...(to ? { lte: dayOnly(to) } : {}) } }
          : {}),
      },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Record (or correct) one day for one worker.
   *
   * Upsert on the `[workerId, date]` pair: logging the same day twice fixes the
   * entry instead of creating a duplicate that would be paid twice.
   */
  async logAttendance(userId: string, workerId: string, data: any) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Worker not found');
    if (!data.date) throw new BadRequestException('A date is required');

    const date = dayOnly(data.date);
    const status = data.status ?? 'PRESENT';
    // An absent day has no hours, whatever the client sent.
    const hoursWorked =
      status === 'PRESENT'
        ? Number(data.hoursWorked ?? worker.expectedHoursPerDay)
        : 0;
    const lateHours = status === 'PRESENT' ? Number(data.lateHours ?? 0) : 0;

    if (hoursWorked < 0 || lateHours < 0) throw new BadRequestException('Hours cannot be negative');

    const payload = {
      status,
      hoursWorked,
      lateHours,
      bonus: Number(data.bonus ?? 0),
      deduction: Number(data.deduction ?? 0),
      notes: data.notes,
    };
    const entry = await this.prisma.attendanceEntry.upsert({
      where: { workerId_date: { workerId, date } },
      update: payload,
      create: { workerId, date, ...payload },
    });
    await this.audit.log(userId, 'LOG_ATTENDANCE', 'Worker', workerId, { date: data.date, status });
    return entry;
  }

  async removeAttendance(userId: string, entryId: string) {
    const entry = await this.prisma.attendanceEntry.delete({ where: { id: entryId } });
    await this.audit.log(userId, 'DELETE_ATTENDANCE', 'Worker', entry.workerId, { date: entry.date });
    return { success: true };
  }

  /**
   * What a worker earned over a period.
   *
   * Daily basis: a present day earns the full daily rate. Hourly basis: hours
   * actually worked × the hourly rate, so a short day pays short automatically.
   * Absent days simply earn nothing — there is no separate "absence penalty",
   * because not paying for a day already is the deduction. Lateness is charged
   * on top only when a `lateDeductionPerHour` is configured, so recording
   * lateness for the record costs nothing unless the business wants it to.
   */
  async payroll(workerId: string, from: string, to: string) {
    const worker = await this.findOne(workerId);
    const entries = await this.prisma.attendanceEntry.findMany({
      where: { workerId, date: { gte: dayOnly(from), lte: dayOnly(to) } },
      orderBy: { date: 'asc' },
    });

    const dailyRate = Number(worker.dailyRate);
    const hourlyRate = Number(worker.hourlyRate);
    const latePerHour = Number(worker.lateDeductionPerHour);

    let daysPresent = 0;
    let daysAbsent = 0;
    let daysLeave = 0;
    let daysHoliday = 0;
    let hoursWorked = 0;
    let lateHours = 0;
    let gross = 0;
    let bonuses = 0;
    let deductions = 0;

    for (const e of entries) {
      const hours = Number(e.hoursWorked);
      const late = Number(e.lateHours);
      bonuses += Number(e.bonus);
      deductions += Number(e.deduction);

      if (e.status === 'PRESENT') {
        daysPresent++;
        hoursWorked += hours;
        lateHours += late;
        gross += worker.payBasis === 'HOURLY' ? hours * hourlyRate : dailyRate;
        deductions += late * latePerHour;
      } else if (e.status === 'ABSENT') daysAbsent++;
      else if (e.status === 'LEAVE') daysLeave++;
      else daysHoliday++;
    }

    const net = round2(gross + bonuses - deductions);
    return {
      worker: {
        id: worker.id, code: worker.code, name: worker.name, jobTitle: worker.jobTitle,
        payBasis: worker.payBasis, payPeriod: worker.payPeriod,
        dailyRate, hourlyRate, lateDeductionPerHour: latePerHour,
      },
      period: { from, to },
      totals: {
        daysPresent, daysAbsent, daysLeave, daysHoliday,
        hoursWorked: round2(hoursWorked),
        lateHours: round2(lateHours),
        gross: round2(gross),
        bonuses: round2(bonuses),
        deductions: round2(deductions),
        // Never hand back a negative payslip — deductions are capped at what
        // was earned, and the overflow is surfaced instead of silently applied.
        net: Math.max(0, net),
        unappliedDeduction: net < 0 ? round2(-net) : 0,
      },
      entries,
    };
  }

  /** Settlement summary across every active worker, for a weekly or monthly run. */
  async payrollSummary(from: string, to: string, payPeriod?: string) {
    const workers = await this.prisma.worker.findMany({
      where: { deletedAt: null, isActive: true, ...(payPeriod ? { payPeriod: payPeriod as any } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    const rows = await Promise.all(workers.map((w) => this.payroll(w.id, from, to)));
    return {
      period: { from, to },
      rows: rows.map((r) => ({ ...r.worker, ...r.totals })),
      grandTotal: round2(rows.reduce((s, r) => s + r.totals.net, 0)),
    };
  }
}
