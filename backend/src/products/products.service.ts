import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';
import { requireTenantId } from '../common/tenant-context';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findAll(query: {
    search?: string;
    categoryId?: string;
    subCategoryId?: string;
    brand?: string;
    isActive?: string;
    archived?: string;
    sortBy?: string;
    sortDir?: string;
    page?: number;
    pageSize?: number;
  }) {
    // `archived=true` shows the archive instead of the active list — the
    // same query, with the soft-delete filter inverted.
    const where: Prisma.ProductWhereInput = query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.subCategoryId) where.subCategoryId = query.subCategoryId;
    else if (query.categoryId) where.subCategory = { categoryId: query.categoryId };
    if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;

    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const sortable = ['name', 'sku', 'brand', 'costPrice', 'salePrice', 'priceUpdatedAt', 'createdAt'];
    const sortBy = sortable.includes(query.sortBy ?? '') ? query.sortBy! : 'name';
    const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ relationLoadStrategy: 'join',
        where,
        include: {
          subCategory: { include: { category: true } },
          stockLevels: { include: { warehouse: true } },
        },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ relationLoadStrategy: 'join',
      where: { id },
      include: {
        subCategory: { include: { category: true, attributeDefs: { orderBy: { sortOrder: 'asc' } } } },
        stockLevels: { include: { warehouse: true } },
        priceHistory: { orderBy: { createdAt: 'desc' }, take: 50, include: { changedBy: { select: { name: true } } } },
        units: { orderBy: { createdAt: 'desc' }, take: 100 },
        supplierProducts: { include: { supplier: true } },
        compatibleFrom: { include: { compatibleWith: { select: { id: true, name: true, sku: true } } } },
        compatibleTo: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * Sub-category every service is filed under, created on first use.
   *
   * `Product.subCategoryId` is a required relation, but asking the admin to file
   * an installation under "Batteries / Lithium" is meaningless. Services get
   * their own bucket instead, so the form can drop the picker entirely and
   * reports still group them sensibly. Restores the rows if they were archived,
   * since the unique constraints (`Category.name`, `SubCategory[categoryId,name]`)
   * apply to soft-deleted rows too.
   */
  private async serviceSubCategoryId(tx: Prisma.TransactionClient): Promise<string> {
    // Category names are unique per store now, so the upsert has to name the
    // store as well. The scoping extension adds `tenantId` to the filter too,
    // but an upsert needs a genuine unique key to decide insert-vs-update.
    const category = await tx.category.upsert({
      where: { tenantId_name: { tenantId: requireTenantId(), name: 'Services' } },
      update: { deletedAt: null },
      create: { name: 'Services', description: 'Labour and services — installation, maintenance, delivery' },
    });
    const sub = await tx.subCategory.upsert({
      where: { categoryId_name: { categoryId: category.id, name: 'General' } },
      update: { deletedAt: null },
      create: { categoryId: category.id, name: 'General' },
    });
    return sub.id;
  }

  /**
   * Strip fields that make no sense for a service. A service is sold as labour:
   * it has no stock, no serials, no warranty period and no physical specs, so
   * those columns are forced to their empty values rather than left to whatever
   * the form last held.
   */
  private static serviceDefaults() {
    return {
      trackSerials: false,
      requireSerialOnSale: false,
      lowStockThreshold: 0,
      brand: null,
      model: null,
      barcode: null,
      warrantyMonths: null,
      performanceWarrantyMonths: null,
      shelfLifeMonths: null,
      attributes: {},
    };
  }

  /**
   * Create a product definition. Deliberately has no effect on stock.
   *
   * This used to accept `serialNumbers` and turn them into in-stock units plus
   * an `IN` movement, so defining a product silently invented inventory that
   * was never bought. Stock now has exactly one origin: goods received against
   * a purchase order (`PurchaseOrdersService.receiveGoods`, which takes serials
   * per line and checks them against the received quantity) or an explicit
   * stock adjustment.
   */
  async create(userId: string, data: any) {
    const isService = data.isService ?? false;
    if (!isService && !data.subCategoryId) {
      // Otherwise the required relation fails with an opaque constraint error.
      throw new BadRequestException('Pick a sub-category, or mark this as a service');
    }
    // A stocked product has no meaningful cost until it is bought: the first
    // goods receipt sets it via weighted average, and because a new product has
    // no stock on hand that calculation reduces to the received unit cost — so
    // anything typed here would be overwritten anyway. Services keep a manual
    // cost, as no purchase order ever touches them.
    const costPrice = data.costPrice ?? 0;

    const product = await this.prisma.$transaction(async (tx) => {
      // A service only carries name, SKU and the two prices; everything else is
      // either meaningless or resolved for it.
      const p = await tx.product.create({
        data: isService
          ? {
              sku: data.sku,
              name: data.name,
              costPrice,
              salePrice: data.salePrice,
              notes: data.notes,
              isService: true,
              subCategoryId: data.subCategoryId || (await this.serviceSubCategoryId(tx)),
              ...ProductsService.serviceDefaults(),
            }
          : {
              sku: data.sku,
              name: data.name,
              brand: data.brand,
              model: data.model,
              subCategoryId: data.subCategoryId,
              attributes: data.attributes ?? {},
              costPrice,
              salePrice: data.salePrice,
              isService: false,
              trackSerials: data.trackSerials ?? true,
              requireSerialOnSale: data.requireSerialOnSale ?? true,
              lowStockThreshold: data.lowStockThreshold ?? 5,
              warrantyMonths: data.warrantyMonths,
              performanceWarrantyMonths: data.performanceWarrantyMonths,
              shelfLifeMonths: data.shelfLifeMonths,
              barcode: data.barcode,
              notes: data.notes,
            },
      });
      await tx.priceHistory.create({
        data: {
          productId: p.id,
          newCostPrice: costPrice,
          newSalePrice: data.salePrice,
          reason: 'Initial price',
          changedById: userId,
        },
      });

      return p;
    });

    await this.audit.log(userId, 'CREATE', 'Product', product.id, {
      sku: product.sku,
      name: product.name,
    });
    return product;
  }

  async update(userId: string, id: string, data: any) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');

    const priceChanged =
      (data.costPrice !== undefined && Number(data.costPrice) !== Number(existing.costPrice)) ||
      (data.salePrice !== undefined && Number(data.salePrice) !== Number(existing.salePrice));

    // `isService` may be absent from a partial update — fall back to the stored value.
    const isService = data.isService ?? existing.isService;

    const product = await this.prisma.$transaction(async (tx) => {
      const base = {
        sku: data.sku,
        name: data.name,
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        notes: data.notes,
        isActive: data.isActive,
        isService: data.isService,
        ...(priceChanged ? { priceUpdatedAt: new Date() } : {}),
      };
      return tx.product.update({
        where: { id },
        data: isService
          ? {
              ...base,
              // Clears stock/warranty/spec fields left over from a product that
              // has just been switched to a service.
              subCategoryId: data.subCategoryId || (await this.serviceSubCategoryId(tx)),
              ...ProductsService.serviceDefaults(),
            }
          : {
              ...base,
              brand: data.brand,
              model: data.model,
              subCategoryId: data.subCategoryId,
              attributes: data.attributes,
              trackSerials: data.trackSerials,
              requireSerialOnSale: data.requireSerialOnSale,
              lowStockThreshold: data.lowStockThreshold,
              warrantyMonths: data.warrantyMonths,
              performanceWarrantyMonths: data.performanceWarrantyMonths,
              shelfLifeMonths: data.shelfLifeMonths,
              barcode: data.barcode,
            },
      });
    });

    if (priceChanged) {
      await this.prisma.priceHistory.create({
        data: {
          productId: id,
          oldCostPrice: existing.costPrice,
          newCostPrice: product.costPrice,
          oldSalePrice: existing.salePrice,
          newSalePrice: product.salePrice,
          reason: data.priceChangeReason ?? 'Manual update',
          changedById: userId,
        },
      });
    }
    await this.audit.log(userId, 'UPDATE', 'Product', id);
    return product;
  }

  /** Bulk price update: rows of { sku, costPrice?, salePrice? } (e.g. parsed from a supplier CSV price list). */
  async bulkPriceUpdate(userId: string, rows: { sku: string; costPrice?: number; salePrice?: number }[], reason?: string) {
    const results: { sku: string; status: string }[] = [];
    for (const row of rows) {
      const product = await this.prisma.product.findFirst({ where: { sku: row.sku } });
      if (!product) {
        results.push({ sku: row.sku, status: 'not found' });
        continue;
      }
      const newCost = row.costPrice ?? Number(product.costPrice);
      const newSale = row.salePrice ?? Number(product.salePrice);
      if (newCost === Number(product.costPrice) && newSale === Number(product.salePrice)) {
        results.push({ sku: row.sku, status: 'unchanged' });
        continue;
      }
      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: product.id },
          data: { costPrice: newCost, salePrice: newSale, priceUpdatedAt: new Date() },
        }),
        this.prisma.priceHistory.create({
          data: {
            productId: product.id,
            oldCostPrice: product.costPrice,
            newCostPrice: newCost,
            oldSalePrice: product.salePrice,
            newSalePrice: newSale,
            reason: reason ?? 'Bulk price import',
            changedById: userId,
          },
        }),
      ]);
      results.push({ sku: row.sku, status: 'updated' });
    }
    await this.audit.log(userId, 'BULK_PRICE_UPDATE', 'Product', undefined, {
      updated: results.filter((r) => r.status === 'updated').length,
      reason,
    });
    return { results };
  }

  /**
   * Create products in bulk from parsed CSV rows.
   *
   * Every row is independent: one bad line reports an error and the rest still
   * import, so a 200-row catalogue is never rejected wholesale for a typo. An
   * existing SKU is skipped rather than overwritten — silently replacing a
   * product the admin already priced would be worse than telling them.
   *
   * Sub-categories are matched by name (case-insensitive), optionally narrowed
   * by category name, because a CSV from a supplier has names, not our ids.
   */
  async importProducts(
    userId: string,
    rows: {
      sku?: string; name?: string; brand?: string; model?: string;
      category?: string; subCategory?: string; salePrice?: number; costPrice?: number;
      barcode?: string; lowStockThreshold?: number; warrantyMonths?: number;
      isService?: boolean; notes?: string;
    }[],
  ) {
    const results: { row: number; sku: string; status: 'created' | 'skipped' | 'error'; message?: string }[] = [];

    for (const [i, row] of rows.entries()) {
      const line = i + 1;
      const sku = String(row.sku ?? '').trim();
      const name = String(row.name ?? '').trim();
      try {
        if (!sku) {
          results.push({ row: line, sku: '', status: 'error', message: 'SKU is required' });
          continue;
        }
        if (!name) {
          results.push({ row: line, sku, status: 'error', message: 'Name is required' });
          continue;
        }
        const salePrice = Number(row.salePrice ?? 0);
        if (!Number.isFinite(salePrice) || salePrice < 0) {
          results.push({ row: line, sku, status: 'error', message: 'Sale price must be zero or greater' });
          continue;
        }

        if (await this.prisma.product.findFirst({ where: { sku }, select: { id: true } })) {
          results.push({ row: line, sku, status: 'skipped', message: 'SKU already exists' });
          continue;
        }

        const isService = row.isService === true;
        let subCategoryId: string | undefined;
        if (!isService) {
          const wanted = String(row.subCategory ?? '').trim();
          if (!wanted) {
            results.push({ row: line, sku, status: 'error', message: 'Sub-category is required' });
            continue;
          }
          const category = String(row.category ?? '').trim();
          const sub = await this.prisma.subCategory.findFirst({
            where: {
              deletedAt: null,
              name: { equals: wanted, mode: 'insensitive' },
              ...(category ? { category: { name: { equals: category, mode: 'insensitive' } } } : {}),
            },
            select: { id: true },
          });
          if (!sub) {
            results.push({ row: line, sku, status: 'error', message: `Sub-category "${wanted}" not found` });
            continue;
          }
          subCategoryId = sub.id;
        }

        // Reuse create() so imports obey exactly the same rules as the form —
        // service defaults, cost handling, initial price history.
        await this.create(userId, {
          sku,
          name,
          brand: row.brand?.trim() || undefined,
          model: row.model?.trim() || undefined,
          barcode: row.barcode?.trim() || undefined,
          notes: row.notes?.trim() || undefined,
          subCategoryId,
          isService,
          salePrice,
          costPrice: row.costPrice === undefined ? undefined : Number(row.costPrice),
          lowStockThreshold: row.lowStockThreshold === undefined ? undefined : Number(row.lowStockThreshold),
          warrantyMonths: row.warrantyMonths === undefined ? undefined : Number(row.warrantyMonths),
        });
        results.push({ row: line, sku, status: 'created' });
      } catch (e: any) {
        results.push({ row: line, sku, status: 'error', message: e?.message ?? 'Could not import this row' });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'error').length;
    await this.audit.log(userId, 'IMPORT', 'Product', undefined, { created, skipped, failed });
    return { created, skipped, failed, results };
  }

  /**
   * Alphabet for generated SKUs: digits and capitals minus the pairs that get
   * misread off a printed label or dictated over the phone — 0/O, 1/I/L.
   */
  private static readonly SKU_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  /**
   * A short, unique, random SKU — six characters, e.g. `K7F3MQ`.
   *
   * Generated server-side rather than in the browser so it can be checked
   * against the unique index before being handed out; a client-side guess
   * would only surface a collision as a failed save. Soft-deleted products
   * still occupy their SKU, so the lookup covers them too. SKUs are unique per
   * store, so two tenants may independently land on the same code.
   */
  async generateSku(length = 6): Promise<{ sku: string }> {
    const alphabet = ProductsService.SKU_ALPHABET;
    for (let attempt = 0; attempt < 10; attempt++) {
      const sku = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
      const taken = await this.prisma.product.findFirst({ where: { sku }, select: { id: true } });
      if (!taken) return { sku };
    }
    // 31^6 ≈ 887M combinations, so ten collisions in a row means something is
    // wrong rather than unlucky.
    throw new BadRequestException('Could not generate a unique SKU, please try again');
  }

  /**
   * Count the references that mean a product has actually been used.
   *
   * Deliberately excluded: `priceHistory` (one row is written by `create`),
   * `stockLevels` at zero quantity, `supplierProducts` and `compatibilityLinks`
   * — all bookkeeping a product can have without ever being traded, and all
   * cascade-deleted with it. A stock level holding real quantity does count:
   * physical stock exists even if no movement was recorded.
   */
  /**
   * Whether this record can be deleted outright, for the confirm dialog to ask
   * the right question before anything is destroyed. `remove()` re-checks this
   * server-side, so a stale answer here can never cause a wrongful delete.
   */
  async usage(id: string): Promise<UsageReport> {
    const counts = await this.productUsage(id);
    return { used: !isUnused(counts), usedBy: usedBy(counts) };
  }

  private async productUsage(id: string): Promise<Record<string, number>> {
    const [
      purchaseOrderItems, salesOrderItems, invoiceItems, quotationItems,
      returnItems, warrantyClaims, stockMovements, units, stockOnHand,
    ] = await this.prisma.$transaction([
      this.prisma.purchaseOrderItem.count({ where: { productId: id } }),
      this.prisma.salesOrderItem.count({ where: { productId: id } }),
      this.prisma.invoiceItem.count({ where: { productId: id } }),
      this.prisma.quotationItem.count({ where: { productId: id } }),
      this.prisma.returnItem.count({ where: { productId: id } }),
      this.prisma.warrantyClaim.count({ where: { productId: id } }),
      this.prisma.stockMovement.count({ where: { productId: id } }),
      this.prisma.productUnit.count({ where: { productId: id } }),
      this.prisma.stockLevel.count({ where: { productId: id, quantity: { gt: 0 } } }),
    ]);
    return {
      purchaseOrderItems, salesOrderItems, invoiceItems, quotationItems,
      returnItems, warrantyClaims, stockMovements, units, stockOnHand,
    };
  }

  /**
   * Bring an archived product back into active use. Archiving only sets
   * `deletedAt` and clears `isActive`, so restoring is the exact inverse:
   * nothing was destroyed, and every document that referenced it still does.
   */
  async restore(userId: string, id: string) {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Product not found');
    if (!row.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.product.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Product', id);
    return { success: true, alreadyActive: false };
  }

  /**
   * Delete a product: permanently when it was never used, otherwise archived so
   * existing documents keep resolving. See `common/safe-delete.ts`.
   */
  async remove(userId: string, id: string): Promise<SafeDeleteResult> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const counts = await this.productUsage(id);
    if (!isUnused(counts)) {
      const used = usedBy(counts);
      const parts: string[] = [];
      if (used.invoiceItems) parts.push(`${used.invoiceItems} invoice item(s)`);
      if (used.salesOrderItems) parts.push(`${used.salesOrderItems} sales order item(s)`);
      if (used.purchaseOrderItems) parts.push(`${used.purchaseOrderItems} purchase order item(s)`);
      if (used.quotationItems) parts.push(`${used.quotationItems} quotation item(s)`);
      if (used.warrantyClaims) parts.push(`${used.warrantyClaims} warranty claim(s)`);
      if (used.returnItems) parts.push(`${used.returnItems} return item(s)`);
      if (used.stockOnHand) parts.push(`${used.stockOnHand} warehouse(s) with stock on hand`);
      if (used.stockMovements) parts.push(`${used.stockMovements} stock movement(s)`);
      if (used.units) parts.push(`${used.units} tracked serial unit(s)`);
      const details = parts.length > 0 ? parts.join(', ') : 'linked transactions';
      throw new BadRequestException(
        `Cannot delete product "${product.name}" (${product.sku}) because it has existing relations (${details}).`,
      );
    }

    // Cascades take priceHistory, stockLevels, supplierProducts and
    // compatibility links with it.
    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'Product', id);
    return { success: true, mode: 'PURGED', usedBy: {} };
  }

  /**
   * Who bought this product — one row per sales-order line, newest first, with
   * the serial numbers that went out on it where the product is tracked.
   *
   * Cancelled orders are excluded: they represent a sale that never happened,
   * so listing that client as a buyer would be wrong.
   */
  async buyers(productId: string, query: { page?: number; pageSize?: number; search?: string }) {
    const where: Prisma.SalesOrderItemWhereInput = {
      productId,
      salesOrder: {
        deletedAt: null,
        status: { not: 'CANCELLED' },
        ...(query.search
          ? { client: { name: { contains: query.search, mode: 'insensitive' as const } } }
          : {}),
      },
    };
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    const totalPromise = this.prisma.salesOrderItem.count({ where });

    const items = await this.prisma.salesOrderItem.findMany({
      relationLoadStrategy: 'join',
      where,
      include: {
        salesOrder: {
          select: {
            id: true,
            number: true,
            orderDate: true,
            status: true,
            client: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { salesOrder: { orderDate: 'desc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Serials are attached to the order, not the line, so they are fetched once
    // for the page's orders rather than per row.
    const orderIds = items.map((i) => i.salesOrder.id);
    const units = orderIds.length
      ? await this.prisma.productUnit.findMany({
          where: { productId, salesOrderId: { in: orderIds } },
          select: { salesOrderId: true, serialNumber: true },
        })
      : [];
    const serialsByOrder = new Map<string, string[]>();
    for (const u of units) {
      if (!u.salesOrderId) continue;
      serialsByOrder.set(u.salesOrderId, [...(serialsByOrder.get(u.salesOrderId) ?? []), u.serialNumber]);
    }

    return {
      items: items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        order: i.salesOrder,
        client: i.salesOrder.client,
        serialNumbers: serialsByOrder.get(i.salesOrder.id) ?? [],
      })),
      total: await totalPromise,
      page,
      pageSize,
    };
  }

  priceHistory(productId: string) {
    return this.prisma.priceHistory.findMany({ relationLoadStrategy: 'join',
      where: { productId },
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { name: true } } },
    });
  }

  async addCompatibility(userId: string, productId: string, compatibleWithId: string, note?: string) {
    if (productId === compatibleWithId) throw new BadRequestException('A product cannot be compatible with itself');
    const link = await this.prisma.compatibilityLink.create({ data: { productId, compatibleWithId, note } });
    await this.audit.log(userId, 'CREATE', 'CompatibilityLink', link.id);
    return link;
  }

  async removeCompatibility(userId: string, id: string) {
    await this.prisma.compatibilityLink.delete({ where: { id } });
    await this.audit.log(userId, 'DELETE', 'CompatibilityLink', id);
    return { success: true };
  }

  brands() {
    return this.prisma.product
      .findMany({ where: { brand: { not: null } }, distinct: ['brand'], select: { brand: true }, orderBy: { brand: 'asc' } })
      .then((rows) => rows.map((r) => r.brand));
  }
}
