import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { applyWeightedAverageCost } from '../common/costing';
import { SafeDeleteResult, UsageReport, isUnused, usedBy } from '../common/safe-delete';

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

  /**
   * Manually add or remove stock — opening balances, found stock, breakage,
   * shrinkage after a count.
   *
   * A positive adjustment may carry `unitCost`, which re-costs the product on
   * the weighted average exactly as a goods receipt does. Without it the units
   * are assumed to have come in at the current average, which is the right
   * default for a recount but wrong for an opening balance at a new price —
   * hence the option. Removals never change the average.
   */
  async manualAdjustment(
    userId: string,
    dto: { productId: string; warehouseId: string; delta: number; reason: string; unitCost?: number },
  ) {
    if (!dto.delta) throw new BadRequestException('Delta must be non-zero');
    if (dto.unitCost !== undefined && dto.delta < 0) {
      throw new BadRequestException('A unit cost only applies when adding stock');
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.unitCost !== undefined && dto.delta > 0) {
        // Must run before adjustStock so on-hand quantity is still pre-adjustment.
        await applyWeightedAverageCost(tx, {
          productId: dto.productId,
          receivedQty: dto.delta,
          receivedUnitCost: dto.unitCost,
          userId,
          source: `stock adjustment (${dto.reason})`,
        });
      }
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

  warehouses(includeArchived = false) {
    return this.prisma.warehouse.findMany({
      where: includeArchived ? undefined : { deletedAt: null },
      orderBy: { id: 'asc' },
    });
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

  /**
   * Business use of a warehouse. A zero-quantity StockLevel is not use: one is
   * created by `adjustStock`'s upsert for every product/warehouse pair it ever
   * touches, so counting them would make an empty warehouse un-purgeable.
   */
  private async warehouseUsage(id: string) {
    const [stocked, units, movementsFrom, movementsTo, salesOrders, purchaseOrders] = await Promise.all([
      this.prisma.stockLevel.count({ where: { warehouseId: id, NOT: { quantity: 0 } } }),
      this.prisma.productUnit.count({ where: { warehouseId: id } }),
      this.prisma.stockMovement.count({ where: { warehouseId: id } }),
      this.prisma.stockMovement.count({ where: { toWarehouseId: id } }),
      this.prisma.salesOrder.count({ where: { warehouseId: id } }),
      this.prisma.purchaseOrder.count({ where: { warehouseId: id } }),
    ]);
    return { stockOnHand: stocked, units, movements: movementsFrom + movementsTo, salesOrders, purchaseOrders };
  }

  /** Can this warehouse be deleted outright? `removeWarehouse()` re-checks. */
  async warehouseUsageReport(id: string): Promise<UsageReport> {
    const counts = await this.warehouseUsage(id);
    return { used: !isUnused(counts), usedBy: usedBy(counts) };
  }

  async removeWarehouse(userId: string, id: string): Promise<SafeDeleteResult> {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');

    // Stock has to live somewhere: removing the only place to put it would leave
    // every receipt and order with nowhere to go.
    const remaining = await this.prisma.warehouse.count({ where: { deletedAt: null, id: { not: id } } });
    if (remaining === 0) throw new BadRequestException('The last warehouse cannot be deleted');
    if (wh.isDefault) throw new BadRequestException('Make another warehouse the default before deleting this one');

    const counts = await this.warehouseUsage(id);
    if (isUnused(counts)) {
      // The empty stock-level rows are bookkeeping and go with it; the FK is
      // Restrict, so they must be cleared explicitly.
      await this.prisma.$transaction([
        this.prisma.stockLevel.deleteMany({ where: { warehouseId: id } }),
        this.prisma.warehouse.delete({ where: { id } }),
      ]);
      await this.audit.log(userId, 'PURGE', 'Warehouse', id, { name: wh.name });
      return { success: true, mode: 'PURGED', usedBy: {} };
    }

    const used = usedBy(counts);
    await this.prisma.warehouse.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Warehouse', id, { name: wh.name, usedBy: used });
    return { success: true, mode: 'ARCHIVED', usedBy: used };
  }

  async restoreWarehouse(userId: string, id: string) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    if (!wh.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.warehouse.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Warehouse', id, { name: wh.name });
    return { success: true, alreadyActive: false };
  }

  // ---- Product units (serial numbers) ----

  units(query: {
    productId?: string;
    salesOrderId?: string;
    purchaseOrderId?: string;
    supplierId?: string;
    warehouseId?: string;
    status?: string;
    serial?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.ProductUnitWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    // Which supplier a unit came from is a property of the PO that brought it in.
    if (query.supplierId) where.purchaseOrder = { supplierId: query.supplierId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.status) where.status = query.status as UnitStatus;
    if (query.serial) where.serialNumber = { contains: query.serial, mode: 'insensitive' };
    // The serials page searches by serial, product name or SKU from one box.
    if (query.search) {
      where.OR = [
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { product: { name: { contains: query.search, mode: 'insensitive' } } },
        { product: { sku: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 50, 200);
    const totalPromise = this.prisma.productUnit.count({ where });
    return this.prisma.productUnit
      .findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true, supplier: { select: { id: true, name: true } } } },
          invoice: { select: { number: true, client: { select: { id: true, name: true, phone: true } } } },
          salesOrder: { select: { id: true, number: true, client: { select: { id: true, name: true, phone: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await totalPromise, page, pageSize }));
  }

  async lookupSerial(serial: string) {
    const unit = await this.prisma.productUnit.findFirst({ relationLoadStrategy: 'join',
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

  async updateUnit(
    userId: string,
    id: string,
    data: { serialNumber?: string; status?: UnitStatus; manufactureDate?: string; warehouseId?: string },
  ) {
    const existing = await this.prisma.productUnit.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Unit not found');

    // Serials are printed on the physical hardware, so correcting a typo has to
    // be possible — but the new value still has to obey the same rules as one
    // captured at goods receipt, and stay unique across every unit.
    let serialNumber: string | undefined;
    if (data.serialNumber !== undefined) {
      serialNumber = data.serialNumber.trim();
      if (!serialNumber) throw new BadRequestException('Serial number cannot be empty');
      if (serialNumber.length > 18) throw new BadRequestException('Serial numbers must be 18 characters or less');
      if (serialNumber !== existing.serialNumber) {
        const clash = await this.prisma.productUnit.findFirst({ where: { serialNumber } });
        if (clash) throw new BadRequestException(`Serial number "${serialNumber}" is already used by another unit`);
      }
    }

    const unit = await this.prisma.productUnit.update({
      where: { id },
      data: {
        serialNumber,
        status: data.status,
        warehouseId: data.warehouseId,
        manufactureDate: data.manufactureDate ? new Date(data.manufactureDate) : undefined,
      },
    });
    await this.audit.log(userId, 'UPDATE', 'ProductUnit', id, {
      ...data,
      ...(serialNumber && serialNumber !== existing.serialNumber ? { previousSerialNumber: existing.serialNumber } : {}),
    });
    return unit;
  }
}
