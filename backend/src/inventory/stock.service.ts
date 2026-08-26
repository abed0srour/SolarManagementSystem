import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { applyWeightedAverageCost } from '../common/costing';
import { SafeDeleteResult, UsageReport, isUnused, usedBy } from '../common/safe-delete';
import { fitsContainer, normaliseSerial, normaliseSerials, repeatedSerials, serialRoom } from './serial-container';

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
    const serialNumbers = normaliseSerials(params.serialNumbers);
    // One batched insert — inserting row by row over a remote pooler is slow
    // enough to blow the transaction timeout on large receipts.
    await tx.productUnit.createMany({
      data: serialNumbers.map((serialNumber) => ({
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
      serialNumber = normaliseSerial(data.serialNumber);
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

  // ---- Serial containers ----
  //
  // A container is the set of serials held for one product in one warehouse.
  // It has exactly as many slots as that warehouse has stock, because a serial
  // is a physical unit sitting on a shelf and the quantity is a count of those
  // same units -- two records of one fact, which is why they are kept equal.
  //
  // Quantity is deliberately not editable from here. It moves when goods are
  // received, sold, returned or adjusted, and those flows already maintain it.
  // What a container edits is *which* serials fill the slots it has.

  /**
   * Every serial held for one product, grouped into one container per warehouse.
   *
   * `missing` is the slots with no serial recorded against them. That is not
   * automatically a fault -- stock added by a manual adjustment arrives with no
   * serials to capture, and someone has to type them in afterwards -- but a
   * container that stays short is what `serialDrift()` reports on.
   *
   * `overfilled` should always be zero. It is surfaced rather than assumed away
   * because the flows that predate this invariant could leave it non-zero, and
   * a reconciliation view that hides the discrepancy it exists to show would be
   * worse than useless.
   */
  async serialContainer(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId },
      select: { id: true, sku: true, name: true, trackSerials: true, requireSerialOnSale: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [levels, units] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { productId },
        include: { warehouse: { select: { id: true, name: true } } },
      }),
      this.prisma.productUnit.findMany({
        where: { productId, status: 'IN_STOCK' },
        select: {
          id: true,
          serialNumber: true,
          warehouseId: true,
          manufactureDate: true,
          purchaseOrderId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const held = new Map<string, typeof units>();
    for (const unit of units) {
      const key = unit.warehouseId ?? '';
      held.set(key, [...(held.get(key) ?? []), unit]);
    }

    const containers = levels.map((level) => {
      const serials = held.get(level.warehouseId) ?? [];
      held.delete(level.warehouseId);
      const capacity = Number(level.quantity);
      return {
        warehouseId: level.warehouseId,
        warehouseName: level.warehouse.name,
        capacity,
        filled: serials.length,
        missing: Math.max(0, capacity - serials.length),
        overfilled: Math.max(0, serials.length - capacity),
        balanced: serials.length === capacity,
        serials,
      };
    });

    // Units in a warehouse this product has no stock level for. Their slots do
    // not exist, so they are pure drift -- and leaving them out of the view
    // would make them invisible to the only screen that could fix them.
    for (const [warehouseId, serials] of held) {
      const warehouse = warehouseId
        ? await this.prisma.warehouse.findFirst({ where: { id: warehouseId }, select: { name: true } })
        : null;
      containers.push({
        warehouseId,
        warehouseName: warehouse?.name ?? 'Unassigned',
        capacity: 0,
        filled: serials.length,
        missing: 0,
        overfilled: serials.length,
        balanced: false,
        serials,
      });
    }

    return {
      product,
      containers,
      totals: {
        capacity: containers.reduce((s, c) => s + c.capacity, 0),
        filled: containers.reduce((s, c) => s + c.filled, 0),
        balanced: containers.every((c) => c.balanced),
      },
    };
  }

  /**
   * Record serials into the empty slots of one container.
   *
   * Rejected rather than silently truncated when there is not enough room: an
   * add that would push the container past the stock on hand means either the
   * goods were never received in the system or someone is entering a serial
   * twice, and both want a human, not a quietly dropped row.
   */
  async addSerials(userId: string, dto: { productId: string; warehouseId: string; serialNumbers: string[] }) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId },
      select: { id: true, name: true, trackSerials: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.trackSerials)
      throw new BadRequestException(
        `"${product.name}" is not tracked by serial number. Turn on serial tracking for it first.`,
      );

    const serials = normaliseSerials(dto.serialNumbers);
    if (!serials.length) throw new BadRequestException('No serial numbers supplied');

    const repeated = repeatedSerials(serials);
    if (repeated.length)
      throw new BadRequestException(`The same serial appears more than once in this batch: ${repeated.join(', ')}`);

    const [level, filled] = await Promise.all([
      this.prisma.stockLevel.findFirst({
        where: { productId: dto.productId, warehouseId: dto.warehouseId },
        include: { warehouse: { select: { name: true } } },
      }),
      this.prisma.productUnit.count({
        where: { productId: dto.productId, warehouseId: dto.warehouseId, status: 'IN_STOCK' },
      }),
    ]);
    const capacity = Number(level?.quantity ?? 0);
    const room = serialRoom(capacity, filled);
    if (!fitsContainer(capacity, filled, serials.length)) {
      const where = level ? `warehouse "${level.warehouse.name}"` : 'that warehouse';
      throw new BadRequestException(
        `"${product.name}" has ${capacity} in stock in ${where} with ${filled} serial${filled === 1 ? '' : 's'} already recorded, ` +
          `so there is room for ${room} more — but ${serials.length} were supplied. ` +
          `If the units have physically arrived, receive them on a purchase order or add them with a stock adjustment first.`,
      );
    }

    const clashes = await this.prisma.productUnit.findMany({
      where: { serialNumber: { in: serials } },
      select: { serialNumber: true },
    });
    if (clashes.length)
      throw new BadRequestException(
        `Already recorded against another unit: ${clashes.map((c) => c.serialNumber).join(', ')}`,
      );

    await this.prisma.productUnit.createMany({
      data: serials.map((serialNumber) => ({
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        serialNumber,
        status: 'IN_STOCK' as const,
      })),
    });
    await this.audit.log(userId, 'CREATE', 'ProductUnit', dto.productId, {
      warehouseId: dto.warehouseId,
      serialNumbers: serials,
    });
    return this.serialContainer(dto.productId);
  }

  /**
   * Take one serial back out of its container, leaving the slot empty.
   *
   * Only a unit still IN_STOCK can go. Once a serial has been sold, returned or
   * sent back to a supplier it is the record of what physically left, and the
   * invoice and warranty history hang off it -- deleting it would erase the
   * answer to "which unit did this customer get". Stock quantity is untouched:
   * removing a mistyped serial does not make a unit vanish off the shelf.
   */
  async removeSerial(userId: string, id: string) {
    const unit = await this.prisma.productUnit.findFirst({
      where: { id },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        productId: true,
        warehouseId: true,
        _count: { select: { warrantyClaims: true } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.status !== 'IN_STOCK')
      throw new BadRequestException(
        `Serial "${unit.serialNumber}" is ${unit.status.toLowerCase().replace(/_/g, ' ')} and is part of that history now, ` +
          `so it cannot be removed. Correct the serial instead if it was mistyped.`,
      );
    if (unit._count.warrantyClaims)
      throw new BadRequestException(
        `Serial "${unit.serialNumber}" has warranty claims recorded against it and cannot be removed.`,
      );

    await this.prisma.productUnit.delete({ where: { id } });
    await this.audit.log(userId, 'DELETE', 'ProductUnit', id, {
      serialNumber: unit.serialNumber,
      productId: unit.productId,
      warehouseId: unit.warehouseId,
    });
    return this.serialContainer(unit.productId);
  }

  /**
   * Every container whose serial count does not match its stock quantity.
   *
   * The flows that maintain stock have not always maintained serials alongside
   * it -- a manual adjustment moves quantity and nothing else, and a transfer
   * only relocates serials when it is handed them -- so existing data drifts.
   * This reports the damage without touching it, so the mismatches can be seen
   * and fixed before anything starts rejecting writes over them.
   */
  async serialDrift(query: { warehouseId?: string } = {}) {
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        product: { trackSerials: true, isActive: true, deletedAt: null },
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
    const counts = await this.prisma.productUnit.groupBy({
      by: ['productId', 'warehouseId'],
      where: {
        status: 'IN_STOCK',
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        product: { trackSerials: true, isActive: true, deletedAt: null },
      },
      _count: { _all: true },
    });
    const counted = new Map(counts.map((c) => [`${c.productId}:${c.warehouseId ?? ''}`, c._count._all]));

    const rows = levels
      .map((level) => {
        const capacity = Number(level.quantity);
        const filled = counted.get(`${level.productId}:${level.warehouseId}`) ?? 0;
        counted.delete(`${level.productId}:${level.warehouseId}`);
        return {
          productId: level.productId,
          sku: level.product.sku,
          productName: level.product.name,
          warehouseId: level.warehouseId,
          warehouseName: level.warehouse.name,
          capacity,
          filled,
          difference: filled - capacity,
        };
      })
      .filter((r) => r.difference !== 0);

    // Serials parked where the product has no stock level at all: counted, but
    // with no quantity to compare against, so the loop above never sees them.
    for (const [key, filled] of counted) {
      const [productId, warehouseId] = key.split(':');
      const [product, warehouse] = await Promise.all([
        this.prisma.product.findFirst({ where: { id: productId }, select: { sku: true, name: true } }),
        warehouseId
          ? this.prisma.warehouse.findFirst({ where: { id: warehouseId }, select: { name: true } })
          : Promise.resolve(null),
      ]);
      rows.push({
        productId,
        sku: product?.sku ?? '—',
        productName: product?.name ?? 'Unknown product',
        warehouseId,
        warehouseName: warehouse?.name ?? 'Unassigned',
        capacity: 0,
        filled,
        difference: filled,
      });
    }

    return {
      items: rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
      total: rows.length,
    };
  }
}
