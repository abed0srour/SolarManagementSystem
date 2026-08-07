import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Core stock mutation. Positive delta adds stock, negative removes.
   * Must be called inside a transaction when part of a larger operation.
   */
  async adjustStock(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      warehouseId: string;
      delta: number;
      type: MovementType;
      userId: string;
      reason?: string;
      refType?: string;
      refId?: string;
      toWarehouseId?: string;
    },
  ) {
    const { productId, warehouseId, delta } = params;
    const level = await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      update: {},
      create: { productId, warehouseId, quantity: 0 },
    });
    if (Number(level.quantity) + delta < 0) {
      const [product, warehouse] = await Promise.all([
        tx.product.findUnique({ where: { id: productId } }),
        tx.warehouse.findUnique({ where: { id: warehouseId } }),
      ]);
      throw new BadRequestException(
        `Not enough stock of "${product?.name ?? `product #${productId}`}" in warehouse "${warehouse?.name ?? warehouseId}": ` +
          `available ${level.quantity}, required ${-delta}. ` +
          `Receive it through a purchase order or add stock via an inventory adjustment first.`,
      );
    }
    await tx.stockLevel.update({
      where: { id: level.id },
      data: { quantity: { increment: delta } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        warehouseId,
        toWarehouseId: params.toWarehouseId,
        type: params.type,
        quantity: Math.abs(delta),
        reason: params.reason,
        refType: params.refType,
        refId: params.refId,
        userId: params.userId,
      },
    });
  }

  async stockOverview(query: { warehouseId?: string; lowOnly?: string; search?: string; page?: number; pageSize?: number }) {
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const products = await this.prisma.product.findMany({ relationLoadStrategy: 'join',
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        lowStockThreshold: true,
        trackSerials: true,
        subCategory: { select: { name: true, category: { select: { name: true } } } },
        stockLevels: query.warehouseId
          ? { where: { warehouseId: query.warehouseId }, include: { warehouse: true } }
          : { include: { warehouse: true } },
      },
      orderBy: { name: 'asc' },
    });
    const rows = products.map((p) => {
      const totalQty = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
      const reserved = p.stockLevels.reduce((s, l) => s + l.reserved, 0);
      return { ...p, totalQty, reserved, isLow: totalQty <= p.lowStockThreshold };
    });
    // isLow depends on the summed stock levels, so filter/paginate in memory
    const filtered = query.lowOnly === 'true' ? rows.filter((r) => r.isLow) : rows;
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  movements(query: { productId?: string; warehouseId?: string; page?: number; pageSize?: number }) {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 50, 200);
    const totalPromise = this.prisma.stockMovement.count({ where });
    return this.prisma.stockMovement
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          product: { select: { sku: true, name: true } },
          warehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async manualAdjustment(
    userId: string,
    dto: { productId: string; warehouseId: string; delta: number; reason: string },
  ) {
    if (!dto.delta) throw new BadRequestException('Delta must be non-zero');
    await this.prisma.$transaction(async (tx) => {
      await this.adjustStock(tx, {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        delta: dto.delta,
        type: 'ADJUSTMENT',
        userId,
        reason: dto.reason,
      });
    });
    await this.audit.log(userId, 'STOCK_ADJUSTMENT', 'Product', dto.productId, dto);
    return { success: true };
  }

  async transfer(
    userId: string,
    dto: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; reason?: string; serialNumbers?: string[] },
  ) {
    if (dto.quantity <= 0) throw new BadRequestException('Quantity must be positive');
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Warehouses must differ');
    await this.prisma.$transaction(async (tx) => {
      await this.adjustStock(tx, {
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        delta: -dto.quantity,
        type: 'TRANSFER',
        userId,
        reason: dto.reason,
        toWarehouseId: dto.toWarehouseId,
      });
      await this.adjustStock(tx, {
        productId: dto.productId,
        warehouseId: dto.toWarehouseId,
        delta: dto.quantity,
        type: 'IN',
        userId,
        reason: dto.reason ?? 'Transfer in',
      });
      if (dto.serialNumbers?.length) {
        await tx.productUnit.updateMany({
          where: { serialNumber: { in: dto.serialNumbers }, productId: dto.productId },
          data: { warehouseId: dto.toWarehouseId },
        });
      }
    });
    await this.audit.log(userId, 'STOCK_TRANSFER', 'Product', dto.productId, dto);
    return { success: true };
  }

  // ---- Warehouses ----

  warehouses() {
    return this.prisma.warehouse.findMany({ orderBy: { id: 'asc' } });
  }

  async createWarehouse(userId: string, data: { name: string; address?: string; isDefault?: boolean }) {
    const wh = await this.prisma.warehouse.create({ data });
    if (data.isDefault) {
      await this.prisma.warehouse.updateMany({ where: { id: { not: wh.id } }, data: { isDefault: false } });
    }
    await this.audit.log(userId, 'CREATE', 'Warehouse', wh.id, { name: wh.name });
    return wh;
  }

  async updateWarehouse(userId: string, id: string, data: { name?: string; address?: string; isDefault?: boolean; isActive?: boolean }) {
    const wh = await this.prisma.warehouse.update({ where: { id }, data });
    if (data.isDefault) {
      await this.prisma.warehouse.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    await this.audit.log(userId, 'UPDATE', 'Warehouse', id, data);
    return wh;
  }

  // ---- Product units (serial numbers) ----

  units(query: { productId?: string; salesOrderId?: string; status?: string; serial?: string; page?: number; pageSize?: number }) {
    const where: Prisma.ProductUnitWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
    if (query.status) where.status = query.status as UnitStatus;
    if (query.serial) where.serialNumber = { contains: query.serial, mode: 'insensitive' };
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 50, 200);
    const totalPromise = this.prisma.productUnit.count({ where });
    return this.prisma.productUnit
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          product: { select: { sku: true, name: true } },
          warehouse: { select: { name: true } },
          invoice: { select: { number: true, client: { select: { id: true, name: true, phone: true } } } },
          salesOrder: { select: { number: true, client: { select: { id: true, name: true, phone: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async lookupSerial(serial: string) {
    const unit = await this.prisma.productUnit.findUnique({ relationLoadStrategy: 'join',
      where: { serialNumber: serial },
      include: {
        product: true,
        warehouse: true,
        invoice: { include: { client: true } },
        warrantyClaims: true,
      },
    });
    if (!unit) throw new NotFoundException('Serial number not found');
    return unit;
  }

  /** Register serial-numbered units into stock (used standalone or by goods receipt). */
  async registerUnits(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      warehouseId: string;
      serialNumbers: string[];
      purchaseOrderId?: string;
      manufactureDate?: Date;
    },
  ) {
    const tooLong = params.serialNumbers.filter((s) => s.length > 18);
    if (tooLong.length)
      throw new BadRequestException(`Serial numbers must be 18 characters or less: ${tooLong.join(', ')}`);
    // One batched insert — inserting row by row over a remote pooler is slow
    // enough to blow the transaction timeout on large receipts.
    await tx.productUnit.createMany({
      data: params.serialNumbers.map((serialNumber) => ({
        productId: params.productId,
        warehouseId: params.warehouseId,
        serialNumber,
        purchaseOrderId: params.purchaseOrderId,
        manufactureDate: params.manufactureDate,
        status: 'IN_STOCK' as const,
      })),
    });
  }

  async updateUnit(userId: string, id: string, data: { status?: UnitStatus; manufactureDate?: string; warehouseId?: string }) {
    const unit = await this.prisma.productUnit.update({
      where: { id },
      data: {
        status: data.status,
        warehouseId: data.warehouseId,
        manufactureDate: data.manufactureDate ? new Date(data.manufactureDate) : undefined,
      },
    });
    await this.audit.log(userId, 'UPDATE', 'ProductUnit', id, data);
    return unit;
  }
}
