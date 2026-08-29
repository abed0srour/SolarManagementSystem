import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StockService } from '../inventory/stock.service';
import { round2 } from '../common/calc';

/** Statuses that mean the unit is no longer sellable stock. */
const FAULT_STATUSES: UnitStatus[] = ['DAMAGED', 'RETURNED', 'RETURNED_TO_SUPPLIER'];

@Injectable()
export class ProductHistoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private stock: StockService,
  ) {}

  /**
   * Every purchase of one product, newest first, with how the price moved.
   *
   * Derived from the purchase orders rather than kept in a table of its own.
   * The orders already are the purchase history — supplier, date, cost,
   * quantity and the invoices raised against them — and a copy would be one
   * more thing to drift out of step with the source.
   *
   * Draft orders are excluded: nothing has been agreed, so their price is a
   * proposal and would distort a trend it never belonged to.
   */
  async purchaseHistory(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId },
      select: { id: true, sku: true, name: true, costPrice: true, trackSerials: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const lines = await this.prisma.purchaseOrderItem.findMany({
      where: { productId, purchaseOrder: { status: { not: 'DRAFT' }, deletedAt: null } },
      select: {
        quantity: true,
        unitCost: true,
        receivedQty: true,
        returnedQty: true,
        lineTotal: true,
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            createdAt: true,
            status: true,
            supplier: { select: { id: true, name: true } },
            invoices: {
              where: { deletedAt: null, status: { not: 'CANCELLED' } },
              select: { id: true, number: true, total: true, status: true },
            },
          },
        },
      },
      orderBy: { purchaseOrder: { createdAt: 'desc' } },
    });

    // Oldest first for the trend, so "change" reads against the purchase before
    // it rather than the one after.
    const chronological = [...lines].reverse();
    let previousCost: number | null = null;
    const trend = chronological.map((line) => {
      const unitCost = Number(line.unitCost);
      const change = previousCost === null ? null : round2(unitCost - previousCost);
      const changePct = previousCost ? round2(((unitCost - previousCost) / previousCost) * 100) : null;
      previousCost = unitCost;
      return {
        purchaseOrderId: line.purchaseOrder.id,
        date: line.purchaseOrder.createdAt,
        supplier: line.purchaseOrder.supplier.name,
        unitCost,
        change,
        changePct,
      };
    });

    const purchases = lines.map((line) => ({
      purchaseOrderId: line.purchaseOrder.id,
      number: line.purchaseOrder.number,
      orderDate: line.purchaseOrder.createdAt,
      status: line.purchaseOrder.status,
      supplierId: line.purchaseOrder.supplier.id,
      supplierName: line.purchaseOrder.supplier.name,
      quantity: line.quantity,
      receivedQty: line.receivedQty,
      returnedQty: line.returnedQty,
      unitCost: Number(line.unitCost),
      lineTotal: Number(line.lineTotal),
      invoices: line.purchaseOrder.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        total: Number(i.total),
        status: i.status,
      })),
    }));

    // One row per supplier: what they have shipped, at what price, and how
    // much of it came back. The last column is the one that decides whether to
    // keep buying from them.
    const bySupplier = new Map<string, { supplierId: string; supplierName: string; orders: number; quantity: number; received: number; returned: number; spend: number; lastOrderDate: Date; costs: number[] }>();
    for (const p of purchases) {
      const current = bySupplier.get(p.supplierId) ?? {
        supplierId: p.supplierId,
        supplierName: p.supplierName,
        orders: 0,
        quantity: 0,
        received: 0,
        returned: 0,
        spend: 0,
        lastOrderDate: p.orderDate,
        costs: [],
      };
      current.orders += 1;
      current.quantity += p.quantity;
      current.received += p.receivedQty;
      current.returned += p.returnedQty;
      current.spend = round2(current.spend + p.lineTotal);
      current.costs.push(p.unitCost);
      if (p.orderDate > current.lastOrderDate) current.lastOrderDate = p.orderDate;
      bySupplier.set(p.supplierId, current);
    }

    const suppliers = [...bySupplier.values()]
      .map(({ costs, ...s }) => ({
        ...s,
        // Weighted by nothing on purpose: this is "what have they charged",
        // not a valuation. The spend/quantity ratio is the weighted figure and
        // is available from the two columns beside it.
        lowestCost: Math.min(...costs),
        highestCost: Math.max(...costs),
        latestCost: costs[0],
      }))
      .sort((a, b) => b.lastOrderDate.getTime() - a.lastOrderDate.getTime());

    const totalQuantity = purchases.reduce((s, p) => s + p.quantity, 0);
    const totalSpend = round2(purchases.reduce((s, p) => s + p.lineTotal, 0));

    return {
      product,
      purchases,
      suppliers,
      trend,
      totals: {
        orders: purchases.length,
        quantity: totalQuantity,
        spend: totalSpend,
        // What a unit has cost on average across every purchase, which is not
        // the same as the product's current weighted-average cost.
        averageUnitCost: totalQuantity ? round2(totalSpend / totalQuantity) : 0,
      },
    };
  }

  /**
   * Serialized units, filtered by whatever the caller knows.
   *
   * The supplier filter reaches through the purchase order, because that is
   * where the relationship actually lives — a unit knows which order brought it
   * in, and the order knows who shipped it.
   */
  async units(query: {
    productId?: string;
    supplierId?: string;
    status?: string;
    serial?: string;
    faultyOnly?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.ProductUnitWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.supplierId) where.purchaseOrder = { supplierId: query.supplierId };
    if (query.status) where.status = query.status as UnitStatus;
    if (query.faultyOnly === 'true') where.status = { in: FAULT_STATUSES };
    if (query.serial) where.serialNumber = { contains: query.serial.trim(), mode: 'insensitive' };

    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);

    const [items, total] = await Promise.all([
      this.prisma.productUnit.findMany({
        relationLoadStrategy: 'join',
        where,
        select: {
          id: true,
          serialNumber: true,
          status: true,
          createdAt: true,
          manufactureDate: true,
          warrantyEndDate: true,
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { name: true } },
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              createdAt: true,
              supplier: { select: { id: true, name: true, phone: true, email: true } },
            },
          },
          salesOrder: { select: { id: true, number: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.productUnit.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** One unit in full, with the supplier who shipped it and everything since. */
  async unit(id: string) {
    const unit = await this.prisma.productUnit.findFirst({
      relationLoadStrategy: 'join',
      where: { id },
      include: {
        product: { select: { id: true, sku: true, name: true, warrantyMonths: true } },
        warehouse: { select: { name: true } },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            createdAt: true,
            supplier: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
        salesOrder: { select: { id: true, number: true, client: { select: { id: true, name: true } } } },
        invoice: { select: { id: true, number: true } },
        warrantyClaims: { select: { id: true, status: true, openedAt: true, issue: true } },
        events: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            refType: true,
            refId: true,
            createdAt: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    if (!unit) throw new NotFoundException('Serial number not found');
    return unit;
  }

  /** Look a unit up by the number printed on it, which is how it arrives. */
  async findBySerial(serial: string) {
    const found = await this.prisma.productUnit.findFirst({
      where: { serialNumber: serial.trim() },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`No unit found with serial "${serial.trim()}"`);
    return this.unit(found.id);
  }

  /**
   * Change a unit's status and record why.
   *
   * The status column and the event log are written together: a status that
   * moved without an event is exactly the gap this module exists to close.
   */
  async setStatus(
    userId: string,
    id: string,
    dto: { status: UnitStatus; note?: string; refType?: string; refId?: string },
  ) {
    const existing = await this.prisma.productUnit.findFirst({
      where: { id },
      select: { id: true, status: true, serialNumber: true },
    });
    if (!existing) throw new NotFoundException('Serial number not found');
    if (existing.status === dto.status)
      throw new BadRequestException(`Serial "${existing.serialNumber}" is already ${dto.status.toLowerCase().replace(/_/g, ' ')}.`);

    await this.prisma.$transaction(async (tx) => {
      await tx.productUnit.update({ where: { id }, data: { status: dto.status } });
      await tx.productUnitEvent.create({
        data: {
          unitId: id,
          fromStatus: existing.status,
          toStatus: dto.status,
          note: dto.note?.trim() || null,
          refType: dto.refType ?? null,
          refId: dto.refId ?? null,
          userId,
        },
      });
    });

    await this.audit.log(userId, 'UNIT_STATUS', 'ProductUnit', id, {
      serialNumber: existing.serialNumber,
      from: existing.status,
      to: dto.status,
      note: dto.note,
    });
    return this.unit(id);
  }

  /**
   * Register serials against a product, recording where they came in.
   *
   * Delegates the counting rules to StockService so a container cannot be
   * overfilled by coming in through this door instead — the invariant belongs
   * to one place, not to whichever endpoint was used.
   */
  async register(
    userId: string,
    dto: { productId: string; warehouseId: string; serialNumbers: string[]; purchaseOrderId?: string },
  ) {
    const result = await this.stock.addSerials(userId, dto);

    const registered = await this.prisma.productUnit.findMany({
      where: { productId: dto.productId, serialNumber: { in: dto.serialNumbers.map((s) => s.trim()) } },
      select: { id: true, status: true },
    });

    await this.prisma.productUnitEvent.createMany({
      data: registered.map((unit) => ({
        unitId: unit.id,
        fromStatus: null,
        toStatus: unit.status,
        note: 'Registered into stock',
        refType: dto.purchaseOrderId ? 'PurchaseOrder' : null,
        refId: dto.purchaseOrderId ?? null,
        userId,
      })),
    });

    if (dto.purchaseOrderId) {
      await this.prisma.productUnit.updateMany({
        where: { id: { in: registered.map((u) => u.id) } },
        data: { purchaseOrderId: dto.purchaseOrderId },
      });
    }
    return result;
  }

  /**
   * Which suppliers the faults are concentrated in.
   *
   * A fault rate is only meaningful against how much that supplier shipped, so
   * both are reported and the caller can see a single failure from a supplier
   * of three units for what it is.
   */
  async supplierFaultReport(query: { productId?: string } = {}) {
    const where: Prisma.ProductUnitWhereInput = { purchaseOrder: { isNot: null } };
    if (query.productId) where.productId = query.productId;

    const units = await this.prisma.productUnit.findMany({
      relationLoadStrategy: 'join',
      where,
      select: {
        status: true,
        purchaseOrder: { select: { supplier: { select: { id: true, name: true } } } },
      },
    });

    const bySupplier = new Map<string, { supplierId: string; supplierName: string; supplied: number; faulty: number }>();
    for (const unit of units) {
      const supplier = unit.purchaseOrder?.supplier;
      if (!supplier) continue;
      const current = bySupplier.get(supplier.id) ?? {
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplied: 0,
        faulty: 0,
      };
      current.supplied += 1;
      if (FAULT_STATUSES.includes(unit.status)) current.faulty += 1;
      bySupplier.set(supplier.id, current);
    }

    return [...bySupplier.values()]
      .map((s) => ({ ...s, faultRate: s.supplied ? round2((s.faulty / s.supplied) * 100) : 0 }))
      .sort((a, b) => b.faulty - a.faulty || b.faultRate - a.faultRate);
  }
}
