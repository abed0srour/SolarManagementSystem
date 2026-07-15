import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';

@Injectable()
export class ServiceJobsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { status?: string; type?: string; clientId?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.ServiceJobWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.type) where.type = query.type as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { technicianName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return this.prisma.serviceJob
      .findMany({
        where,
        include: { client: { select: { name: true } }, salesOrder: { select: { number: true } } },
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await this.prisma.serviceJob.count({ where }), page, pageSize }));
  }

  async findOne(id: string) {
    const job = await this.prisma.serviceJob.findUnique({
      where: { id },
      include: {
        client: { include: { addresses: true } },
        salesOrder: { select: { id: true, number: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!job) throw new NotFoundException('Service job not found');
    return job;
  }

  async create(userId: string, dto: any) {
    const number = await this.numbering.next('JOB');
    const job = await this.prisma.serviceJob.create({
      data: {
        number,
        clientId: dto.clientId,
        salesOrderId: dto.salesOrderId,
        type: dto.type ?? 'INSTALLATION',
        technicianName: dto.technicianName,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        notes: dto.notes,
        createdById: userId,
      },
    });
    await this.audit.log(userId, 'CREATE', 'ServiceJob', job.id, { number });
    return job;
  }

  async update(userId: string, id: string, dto: any) {
    const completing = dto.status === 'COMPLETED';
    const job = await this.prisma.serviceJob.update({
      where: { id },
      data: {
        clientId: dto.clientId,
        salesOrderId: dto.salesOrderId,
        type: dto.type,
        status: dto.status,
        technicianName: dto.technicianName,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        notes: dto.notes,
        ...(completing ? { completedDate: new Date() } : {}),
      },
    });
    await this.audit.log(userId, 'UPDATE', 'ServiceJob', id, dto);
    return job;
  }
}
