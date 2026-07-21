import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  private intervalDays(visitsPerYear: number) {
    return Math.max(1, Math.round(365 / Math.max(1, visitsPerYear)));
  }

  findAll(query: { status?: string; installationId?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.MaintenanceContractWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.installationId) where.installationId = query.installationId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { installation: { number: { contains: query.search, mode: 'insensitive' } } },
        { installation: { client: { name: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.maintenanceContract.count({ where });
    return this.prisma.maintenanceContract
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: { installation: { select: { id: true, number: true, client: { select: { id: true, name: true } } } } },
        orderBy: [{ nextVisitDate: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async create(userId: string, dto: any) {
    const number = await this.numbering.next('CONTRACT');
    const startDate = new Date(dto.startDate);
    const visitsPerYear = dto.visitsPerYear ?? 2;
    const nextVisitDate = dto.nextVisitDate
      ? new Date(dto.nextVisitDate)
      : new Date(startDate.getTime() + this.intervalDays(visitsPerYear) * 86400000);
    const contract = await this.prisma.maintenanceContract.create({
      data: {
        number,
        installationId: dto.installationId,
        startDate,
        endDate: new Date(dto.endDate),
        visitsPerYear,
        pricePerYear: dto.pricePerYear ?? 0,
        nextVisitDate,
        notes: dto.notes,
      },
    });
    await this.audit.log(userId, 'CREATE', 'MaintenanceContract', contract.id, { number });
    return contract;
  }

  async update(userId: string, id: string, dto: any) {
    const contract = await this.prisma.maintenanceContract.update({
      where: { id },
      data: {
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        visitsPerYear: dto.visitsPerYear,
        pricePerYear: dto.pricePerYear,
        nextVisitDate: dto.nextVisitDate ? new Date(dto.nextVisitDate) : undefined,
        notes: dto.notes,
      },
    });
    await this.audit.log(userId, 'UPDATE', 'MaintenanceContract', id, dto);
    return contract;
  }

  /** Record a completed visit: bumps lastVisitDate and schedules the next one, optionally creating a service job. */
  async recordVisit(userId: string, id: string, dto: { visitDate?: string; technicianName?: string; createServiceJob?: boolean; notes?: string }) {
    const contract = await this.prisma.maintenanceContract.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: { installation: { select: { clientId: true, number: true } } },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    const visitDate = dto.visitDate ? new Date(dto.visitDate) : new Date();
    const nextVisitDate = new Date(visitDate.getTime() + this.intervalDays(contract.visitsPerYear) * 86400000);

    const updated = await this.prisma.maintenanceContract.update({
      where: { id },
      data: { lastVisitDate: visitDate, nextVisitDate },
    });

    let job: { id: string; number: string } | null = null;
    if (dto.createServiceJob !== false) {
      const number = await this.numbering.next('JOB');
      const created = await this.prisma.serviceJob.create({
        data: {
          number,
          clientId: contract.installation.clientId,
          type: 'MAINTENANCE',
          status: 'COMPLETED',
          technicianName: dto.technicianName,
          scheduledDate: visitDate,
          completedDate: visitDate,
          notes: dto.notes ?? `Maintenance visit for contract ${contract.number} (${contract.installation.number})`,
          createdById: userId,
        },
      });
      job = { id: created.id, number: created.number };
    }

    await this.audit.log(userId, 'VISIT', 'MaintenanceContract', id, { visitDate: visitDate.toISOString(), job: job?.number });
    return { contract: updated, serviceJob: job };
  }

  async remove(userId: string, id: string) {
    await this.prisma.maintenanceContract.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'MaintenanceContract', id);
    return { deleted: true };
  }

  /** Daily housekeeping: expire ended contracts, notify visits due within 7 days and contracts expiring within 30. */
  @Cron('0 6 * * *')
  async dailyChecks() {
    const now = new Date();
    await this.prisma.maintenanceContract.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: now }, deletedAt: null },
      data: { status: 'EXPIRED' },
    });

    const soon = new Date(now.getTime() + 7 * 86400000);
    const dueVisits = await this.prisma.maintenanceContract.findMany({ relationLoadStrategy: 'join',
      where: { status: 'ACTIVE', deletedAt: null, nextVisitDate: { lte: soon } },
      include: { installation: { select: { number: true, client: { select: { name: true } } } } },
    });
    for (const c of dueVisits) {
      await this.notifyOnce(
        'MAINTENANCE_VISIT_DUE',
        'MaintenanceContract',
        c.id,
        `Maintenance visit due for ${c.installation.number} (${c.installation.client.name}) — contract ${c.number}, due ${c.nextVisitDate?.toISOString().slice(0, 10)}`,
      );
    }

    const expiring = new Date(now.getTime() + 30 * 86400000);
    const expiringContracts = await this.prisma.maintenanceContract.findMany({ relationLoadStrategy: 'join',
      where: { status: 'ACTIVE', deletedAt: null, endDate: { lte: expiring } },
      include: { installation: { select: { number: true, client: { select: { name: true } } } } },
    });
    for (const c of expiringContracts) {
      await this.notifyOnce(
        'CONTRACT_EXPIRING',
        'MaintenanceContract',
        c.id,
        `Maintenance contract ${c.number} for ${c.installation.number} (${c.installation.client.name}) expires on ${c.endDate.toISOString().slice(0, 10)}`,
      );
    }
  }

  private async notifyOnce(type: any, entity: string, entityId: string, message: string) {
    const existing = await this.prisma.notification.findFirst({ where: { type, entity, entityId, isRead: false } });
    if (existing) return;
    await this.prisma.notification.create({ data: { type, entity, entityId, message } });
  }
}
