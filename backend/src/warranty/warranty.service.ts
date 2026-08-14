import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';

@Injectable()
export class WarrantyService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
  ) {}

  findAll(query: { status?: string; clientId?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.WarrantyClaimWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { product: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.warrantyClaim.count({ where });
    return this.prisma.warrantyClaim
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          client: { select: { name: true } },
          product: { select: { sku: true, name: true } },
          productUnit: { select: { serialNumber: true, warrantyEndDate: true } },
          invoice: { select: { id: true, number: true } },
        },
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async findOne(id: string) {
    const claim = await this.prisma.warrantyClaim.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        client: true,
        product: true,
        productUnit: true,
        invoice: { select: { id: true, number: true, issueDate: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!claim) throw new NotFoundException('Warranty claim not found');
    return claim;
  }

  /** Open a claim — by serial number when available (auto-links unit, invoice, product, warranty dates). */
  async create(userId: string, dto: { clientId?: string; productId?: string; serialNumber?: string; invoiceId?: string; issue: string }) {
    let productId = dto.productId;
    let clientId = dto.clientId;
    let invoiceId = dto.invoiceId;
    let productUnitId: string | undefined;
    let underWarranty: boolean | undefined;

    if (dto.serialNumber) {
      const unit = await this.prisma.productUnit.findUnique({ relationLoadStrategy: 'join',
        where: { serialNumber: dto.serialNumber },
        include: { invoice: true },
      });
      if (!unit) throw new NotFoundException(`Serial number ${dto.serialNumber} not found`);
      productUnitId = unit.id;
      productId = unit.productId;
      invoiceId = invoiceId ?? unit.invoiceId ?? undefined;
      clientId = clientId ?? unit.invoice?.clientId ?? undefined;
      underWarranty = unit.warrantyEndDate ? unit.warrantyEndDate >= new Date() : undefined;
    }
    if (!productId) throw new BadRequestException('Provide a serial number or a product');
    if (!clientId) throw new BadRequestException('Client is required (not derivable from serial)');

    const number = await this.numbering.next('CLAIM');
    const claim = await this.prisma.warrantyClaim.create({
      data: {
        number,
        clientId,
        productId,
        productUnitId,
        invoiceId,
        serialNumber: dto.serialNumber,
        issue: dto.issue,
        createdById: userId,
      },
    });
    await this.prisma.notification.create({
      data: {
        type: 'WARRANTY_CLAIM_OPENED',
        message: `Warranty claim ${number} opened${dto.serialNumber ? ` for serial ${dto.serialNumber}` : ''}${underWarranty === false ? ' (WARRANTY EXPIRED)' : ''}`,
        entity: 'WarrantyClaim',
        entityId: claim.id,
      },
    });
    await this.audit.log(userId, 'CREATE', 'WarrantyClaim', claim.id, { number });
    return { ...claim, underWarranty };
  }

  async update(userId: string, id: string, dto: { status?: string; resolution?: string; issue?: string }) {
    const closing = dto.status && ['RESOLVED', 'REPLACED', 'REJECTED'].includes(dto.status);
    const claim = await this.prisma.warrantyClaim.update({
      where: { id },
      data: {
        status: dto.status as any,
        resolution: dto.resolution,
        issue: dto.issue,
        ...(closing ? { closedAt: new Date() } : {}),
      },
    });
    await this.audit.log(userId, 'UPDATE', 'WarrantyClaim', id, dto);
    return claim;
  }

  /** Units whose warranty expires within the next N days (default 60) — upsell/maintenance leads. */
  expiringSoon(days = 60, query: { page?: number; pageSize?: number } = {}) {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 3600 * 1000);
    const where: Prisma.ProductUnitWhereInput = { warrantyEndDate: { gte: now, lte: until }, status: 'SOLD' };
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.productUnit.count({ where });
    return this.prisma.productUnit
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          product: { select: { sku: true, name: true } },
          invoice: { select: { number: true, client: { select: { id: true, name: true, phone: true } } } },
        },
        orderBy: { warrantyEndDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }
}
