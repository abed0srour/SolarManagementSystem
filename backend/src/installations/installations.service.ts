import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { round2 } from '../common/calc';

/** kg of CO2 avoided per kWh of solar production (regional grid/diesel mix). */
const CO2_KG_PER_KWH = 0.7;

@Injectable()
export class InstallationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { status?: string; clientId?: string; systemType?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.InstallationWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.systemType) where.systemType = query.systemType as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { siteAddress: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.installation.count({ where });
    return this.prisma.installation
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          client: { select: { name: true } },
          salesOrder: { select: { number: true } },
          _count: { select: { readings: true, contracts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const inst = await this.prisma.installation.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: { include: { addresses: true } },
        salesOrder: { select: { id: true, number: true, status: true } },
        contracts: { where: { deletedAt: null }, orderBy: { endDate: 'desc' } },
        createdBy: { select: { name: true } },
      },
    });
    if (!inst) throw new NotFoundException('Installation not found');

    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [allTime, last30] = await Promise.all([
      this.prisma.energyReading.aggregate({ where: { installationId: id }, _sum: { energyKwh: true } }),
      this.prisma.energyReading.aggregate({ where: { installationId: id, readingDate: { gte: since30 } }, _sum: { energyKwh: true } }),
    ]);
    const kwhAllTime = Number(allTime._sum.energyKwh ?? 0);
    return {
      ...inst,
      production: {
        kwhAllTime,
        kwhLast30: Number(last30._sum.energyKwh ?? 0),
        savingsAllTime: round2(kwhAllTime * Number(inst.tariffPerKwh)),
        co2SavedKg: round2(kwhAllTime * CO2_KG_PER_KWH),
      },
    };
  }

  async create(userId: string, dto: any) {
    const number = await this.numbering.next('INSTALLATION');
    const inst = await this.prisma.installation.create({
      data: {
        number,
        clientId: dto.clientId,
        salesOrderId: dto.salesOrderId,
        systemType: dto.systemType ?? 'HYBRID',
        siteAddress: dto.siteAddress,
        city: dto.city,
        latitude: dto.latitude,
        longitude: dto.longitude,
        capacityKw: dto.capacityKw ?? 0,
        panelCount: dto.panelCount ?? 0,
        batteryKwh: dto.batteryKwh ?? 0,
        tariffPerKwh: dto.tariffPerKwh ?? 0.2,
        expectedMonthlyKwh: dto.expectedMonthlyKwh,
        notes: dto.notes,
        createdById: userId,
      },
    });
    await this.audit.log(userId, 'CREATE', 'Installation', inst.id, { number });
    return inst;
  }

  async update(userId: string, id: string, dto: any) {
    const existing = await this.prisma.installation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Installation not found');
    const data: Prisma.InstallationUpdateInput = {
      client: dto.clientId ? { connect: { id: dto.clientId } } : undefined,
      salesOrder: dto.salesOrderId ? { connect: { id: dto.salesOrderId } } : undefined,
      status: dto.status,
      systemType: dto.systemType,
      siteAddress: dto.siteAddress,
      city: dto.city,
      latitude: dto.latitude,
      longitude: dto.longitude,
      capacityKw: dto.capacityKw,
      panelCount: dto.panelCount,
      batteryKwh: dto.batteryKwh,
      tariffPerKwh: dto.tariffPerKwh,
      expectedMonthlyKwh: dto.expectedMonthlyKwh,
      notes: dto.notes,
    };
    if (dto.status === 'INSTALLING' && !existing.installedAt) data.installedAt = new Date();
    if (['COMMISSIONED', 'ACTIVE'].includes(dto.status) && !existing.commissionedAt) data.commissionedAt = new Date();
    const inst = await this.prisma.installation.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'Installation', id, dto);
    return inst;
  }

  async remove(userId: string, id: string) {
    const inst = await this.prisma.installation.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException('Installation not found');

    const [contracts, readings] = await Promise.all([
      this.prisma.maintenanceContract.count({ where: { installationId: id, deletedAt: null } }),
      this.prisma.energyReading.count({ where: { installationId: id } }),
    ]);

    if (contracts > 0 || readings > 0) {
      const parts: string[] = [];
      if (contracts > 0) parts.push(`${contracts} maintenance contract(s)`);
      if (readings > 0) parts.push(`${readings} energy reading(s)`);
      throw new BadRequestException(
        `Cannot delete installation "${inst.number || id}" because it has existing relations (${parts.join(', ')}).`,
      );
    }

    await this.prisma.installation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Installation', id, { number: inst.number });
    return { deleted: true };
  }

  // ---------- Energy readings ----------

  listReadings(installationId: string, query: { from?: string; to?: string; page?: number; pageSize?: number }) {
    const where: Prisma.EnergyReadingWhereInput = { installationId };
    if (query.from || query.to) {
      where.readingDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 31, 366);
    const totalPromise = this.prisma.energyReading.count({ where });
    return this.prisma.energyReading
      .findMany({ where, orderBy: { readingDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async upsertReading(userId: string, installationId: string, dto: any) {
    const readingDate = new Date(dto.readingDate);
    const reading = await this.prisma.energyReading.upsert({
      where: { installationId_readingDate: { installationId, readingDate } },
      update: { energyKwh: dto.energyKwh, peakPowerKw: dto.peakPowerKw, sunHours: dto.sunHours, note: dto.note },
      create: {
        installationId,
        readingDate,
        energyKwh: dto.energyKwh,
        peakPowerKw: dto.peakPowerKw,
        sunHours: dto.sunHours,
        note: dto.note,
      },
    });
    await this.audit.log(userId, 'UPSERT', 'EnergyReading', reading.id, { installationId, readingDate: dto.readingDate });
    return reading;
  }

  async bulkReadings(userId: string, installationId: string, rows: any[]) {
    let count = 0;
    for (const dto of rows) {
      await this.upsertReading(userId, installationId, dto);
      count++;
    }
    return { imported: count };
  }

  async deleteReading(userId: string, installationId: string, readingId: string) {
    await this.prisma.energyReading.delete({ where: { id: readingId } });
    await this.audit.log(userId, 'DELETE', 'EnergyReading', readingId, { installationId });
    return { deleted: true };
  }

  /** Monthly production series + savings for one installation. */
  async production(id: string, months = 12) {
    const inst = await this.prisma.installation.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException('Installation not found');
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const readings = await this.prisma.energyReading.findMany({
      where: { installationId: id, readingDate: { gte: since } },
      orderBy: { readingDate: 'asc' },
    });
    const byMonth = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const d = new Date(since);
      d.setMonth(d.getMonth() + i);
      byMonth.set(d.toISOString().slice(0, 7), 0);
    }
    for (const r of readings) {
      const key = r.readingDate.toISOString().slice(0, 7);
      byMonth.set(key, round2((byMonth.get(key) ?? 0) + Number(r.energyKwh)));
    }
    const tariff = Number(inst.tariffPerKwh);
    return {
      months: [...byMonth.entries()].map(([month, kwh]) => ({
        month,
        kwh,
        savings: round2(kwh * tariff),
        expected: inst.expectedMonthlyKwh ? Number(inst.expectedMonthlyKwh) : null,
      })),
    };
  }

  // ---------- Fleet monitoring ----------

  async fleetStats() {
    const activeWhere: Prisma.InstallationWhereInput = { deletedAt: null, status: { in: ['COMMISSIONED', 'ACTIVE'] } };
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const yearStart = new Date();
    yearStart.setMonth(yearStart.getMonth() - 11);
    yearStart.setDate(1);
    yearStart.setHours(0, 0, 0, 0);

    const [systems, capacity, allTime, thisMonth, statusCounts] = await Promise.all([
      this.prisma.installation.count({ where: activeWhere }),
      this.prisma.installation.aggregate({ where: activeWhere, _sum: { capacityKw: true, batteryKwh: true } }),
      this.prisma.energyReading.aggregate({ _sum: { energyKwh: true } }),
      this.prisma.energyReading.aggregate({ where: { readingDate: { gte: monthStart } }, _sum: { energyKwh: true } }),
      this.prisma.installation.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
    ]);

    // Fleet-wide monthly production (last 12 months)
    const readings = await this.prisma.energyReading.findMany({
      where: { readingDate: { gte: yearStart } },
      select: { readingDate: true, energyKwh: true },
    });
    const byMonth = new Map<string, number>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(yearStart);
      d.setMonth(d.getMonth() + i);
      byMonth.set(d.toISOString().slice(0, 7), 0);
    }
    for (const r of readings) {
      const key = r.readingDate.toISOString().slice(0, 7);
      byMonth.set(key, round2((byMonth.get(key) ?? 0) + Number(r.energyKwh)));
    }

    // Top systems by last-30-day production
    const top = await this.prisma.energyReading.groupBy({
      by: ['installationId'],
      where: { readingDate: { gte: since30 } },
      _sum: { energyKwh: true },
      orderBy: { _sum: { energyKwh: 'desc' } },
      take: 10,
    });
    const topInstallations = await this.prisma.installation.findMany({ relationLoadStrategy: 'join',
      where: { id: { in: top.map((t) => t.installationId) } },
      include: { client: { select: { name: true } } },
    });
    const instMap = new Map(topInstallations.map((i) => [i.id, i]));

    const kwhAllTime = Number(allTime._sum.energyKwh ?? 0);
    // Weighted average tariff is overkill here; use per-installation tariffs for top list, fleet default for totals.
    const tariffAgg = await this.prisma.installation.aggregate({ where: activeWhere, _avg: { tariffPerKwh: true } });
    const avgTariff = Number(tariffAgg._avg.tariffPerKwh ?? 0.2);

    return {
      kpis: {
        activeSystems: systems,
        totalCapacityKw: Number(capacity._sum.capacityKw ?? 0),
        totalBatteryKwh: Number(capacity._sum.batteryKwh ?? 0),
        kwhAllTime,
        kwhThisMonth: Number(thisMonth._sum.energyKwh ?? 0),
        savingsAllTime: round2(kwhAllTime * avgTariff),
        co2SavedKg: round2(kwhAllTime * CO2_KG_PER_KWH),
      },
      byStatus: statusCounts.map((s) => ({ status: s.status, count: s._count })),
      monthlyProduction: [...byMonth.entries()].map(([month, kwh]) => ({ month, kwh })),
      topSystems: top.map((t) => {
        const inst = instMap.get(t.installationId);
        return {
          id: t.installationId,
          number: inst?.number,
          client: inst?.client?.name,
          capacityKw: Number(inst?.capacityKw ?? 0),
          kwh30d: Number(t._sum.energyKwh ?? 0),
        };
      }),
    };
  }
}
