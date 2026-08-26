import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { isUnused, SafeDeleteResult, UsageReport, usedBy } from '../common/safe-delete';
import { requireTenantId } from '../common/tenant-context';
import { buildSkuPrefix, formatSku, nextSkuSequence } from './sku';

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
    parentOnly?: string;
    sortBy?: string;
    sortDir?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.ProductWhereInput = query.archived === 'true' ? { deletedAt: { not: null } } : { deletedAt: null };
    
    // By default in catalog views or when parentOnly=true, only show parent products
    // (variants are nested under their parent)
    if (query.parentOnly === 'true') {
      where.isVariant = false;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
                { barcode: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          },
        },
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
      this.prisma.product.findMany({
        where,
        include: {
          subCategory: { include: { category: true } },
          stockLevels: { include: { warehouse: true } },
          customAttributes: { orderBy: { sortOrder: 'asc' } },
          variants: {
            where: { deletedAt: null },
            include: { stockLevels: { include: { warehouse: true } } },
            orderBy: { sku: 'asc' },
          },
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
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        subCategory: { include: { category: true, attributeDefs: { orderBy: { sortOrder: 'asc' } } } },
        stockLevels: { include: { warehouse: true } },
        priceHistory: { orderBy: { createdAt: 'desc' }, take: 50, include: { changedBy: { select: { name: true } } } },
        units: { orderBy: { createdAt: 'desc' }, take: 100 },
        supplierProducts: { include: { supplier: true } },
        compatibleFrom: { include: { compatibleWith: { select: { id: true, name: true, sku: true } } } },
        compatibleTo: { include: { product: { select: { id: true, name: true, sku: true } } } },
        customAttributes: { orderBy: { sortOrder: 'asc' } },
        variants: {
          where: { deletedAt: null },
          include: { stockLevels: { include: { warehouse: true } } },
          orderBy: { sku: 'asc' },
        },
        parent: { select: { id: true, name: true, sku: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /**
   * Sub-category every service is filed under, created on first use.
   */
  private async serviceSubCategoryId(tx: Prisma.TransactionClient): Promise<string> {
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

  async create(userId: string, data: any) {
    const isService = data.isService ?? false;
    if (!isService && !data.subCategoryId) {
      throw new BadRequestException('Pick a sub-category, or mark this as a service');
    }
    const costPrice = data.costPrice ?? 0;

    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: isService
          ? {
              sku: data.sku,
              name: data.name,
              costPrice,
              salePrice: data.salePrice,
              imageUrl: data.imageUrl ?? null,
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
              imageUrl: data.imageUrl ?? null,
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

    const isService = data.isService ?? existing.isService;

    const product = await this.prisma.$transaction(async (tx) => {
      const base = {
        sku: data.sku,
        name: data.name,
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : undefined,
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

  /**
   * Dynamic Attribute & Variant Management
   */
  async getVariants(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        customAttributes: { orderBy: { sortOrder: 'asc' } },
        variants: {
          where: { deletedAt: null },
          include: { stockLevels: { include: { warehouse: true } } },
          orderBy: { sku: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return {
      attributes: product.customAttributes,
      variants: product.variants,
    };
  }

  async setAttributes(userId: string, productId: string, attributes: any[]) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const tenantId = requireTenantId();
    await this.prisma.$transaction(async (tx) => {
      await tx.productAttribute.deleteMany({ where: { productId } });
      for (const [idx, attr] of attributes.entries()) {
        await tx.productAttribute.create({
          data: {
            tenantId,
            productId,
            name: attr.name.trim(),
            type: attr.type,
            unit: attr.unit?.trim() || null,
            isFreeForm: Boolean(attr.isFreeForm),
            permittedValues: attr.permittedValues ?? null,
            sortOrder: attr.sortOrder ?? idx,
          },
        });
      }
    });

    await this.audit.log(userId, 'UPDATE_ATTRIBUTES', 'Product', productId, {
      count: attributes.length,
    });

    return this.getVariants(productId);
  }

  async generateVariants(userId: string, productId: string, data: { attributes?: any[]; variants: any[] }) {
    const parent = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { customAttributes: true },
    });
    if (!parent) throw new NotFoundException('Parent product not found');

    const tenantId = requireTenantId();

    const createdVariants = await this.prisma.$transaction(async (tx) => {
      if (data.attributes && Array.isArray(data.attributes)) {
        await tx.productAttribute.deleteMany({ where: { productId } });
        for (const [idx, attr] of data.attributes.entries()) {
          await tx.productAttribute.create({
            data: {
              tenantId,
              productId,
              name: attr.name.trim(),
              type: attr.type,
              unit: attr.unit?.trim() || null,
              isFreeForm: Boolean(attr.isFreeForm),
              permittedValues: attr.permittedValues ?? null,
              sortOrder: attr.sortOrder ?? idx,
            },
          });
        }
      }

      const results: any[] = [];
      for (const v of data.variants) {
        const sku = String(v.sku).trim();
        const name = String(v.name).trim();
        const salePrice = Number(v.salePrice) || Number(parent.salePrice);
        const costPrice = v.costPrice !== undefined ? Number(v.costPrice) : Number(parent.costPrice);

        const existing = await tx.product.findFirst({
          where: { sku, tenantId },
        });

        if (existing) {
          if (existing.parentProductId && existing.parentProductId !== parent.id) {
            throw new BadRequestException(`SKU "${sku}" is already in use by another product variant`);
          }
          if (!existing.parentProductId && existing.id !== parent.id) {
            throw new BadRequestException(`SKU "${sku}" is already in use by another product`);
          }
          const updated = await tx.product.update({
            where: { id: existing.id },
            data: {
              name,
              salePrice,
              costPrice,
              barcode: v.barcode || existing.barcode,
              imageUrl: v.imageUrl || existing.imageUrl,
              variantAttributes: v.variantAttributes ?? {},
              isActive: true,
              deletedAt: null,
            },
          });
          results.push(updated);
        } else {
          const created = await tx.product.create({
            data: {
              tenantId,
              parentProductId: parent.id,
              isVariant: true,
              sku,
              name,
              brand: parent.brand,
              model: parent.model,
              subCategoryId: parent.subCategoryId,
              attributes: (parent.attributes as any) ?? {},
              variantAttributes: v.variantAttributes ?? {},
              costPrice,
              salePrice,
              isService: parent.isService,
              trackSerials: parent.trackSerials,
              requireSerialOnSale: parent.requireSerialOnSale,
              lowStockThreshold: parent.lowStockThreshold,
              warrantyMonths: parent.warrantyMonths,
              performanceWarrantyMonths: parent.performanceWarrantyMonths,
              shelfLifeMonths: parent.shelfLifeMonths,
              barcode: v.barcode || null,
              imageUrl: v.imageUrl || parent.imageUrl,
              notes: parent.notes,
            },
          });

          await tx.priceHistory.create({
            data: {
              productId: created.id,
              newCostPrice: costPrice,
              newSalePrice: salePrice,
              reason: 'Initial variant price',
              changedById: userId,
            },
          });

          results.push(created);
        }
      }

      await tx.product.update({
        where: { id: parent.id },
        data: { hasVariants: true },
      });

      return results;
    });

    await this.audit.log(userId, 'GENERATE_VARIANTS', 'Product', parent.id, {
      variantCount: createdVariants.length,
    });

    return this.getVariants(productId);
  }

  async deleteVariant(userId: string, productId: string, variantId: string) {
    const variant = await this.prisma.product.findFirst({
      where: { id: variantId, parentProductId: productId },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    const counts = await this.productUsage(variantId);
    if (!isUnused(counts)) {
      throw new BadRequestException('Cannot delete variant with existing sales, purchases or inventory records');
    }

    await this.prisma.product.delete({ where: { id: variantId } });

    const remaining = await this.prisma.product.count({
      where: { parentProductId: productId, deletedAt: null },
    });
    if (remaining === 0) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { hasVariants: false },
      });
    }

    await this.audit.log(userId, 'DELETE_VARIANT', 'Product', variantId, {
      parentProductId: productId,
    });

    return { success: true };
  }

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

  private static readonly SKU_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  /**
   * A SKU that says what the product is.
   *
   * Built from whatever the form has filled in so far -- category, brand, model
   * -- and closed with a number that counts within that combination, so the
   * third Jinko panel is PAN-JIN-JKM550-0003 rather than an unrelated code.
   *
   * Falls back to the old random form when there is nothing to build from: a
   * brand-new product with no category chosen yet, or one described only in
   * Arabic, which leaves no Latin characters to abbreviate. The button then
   * still works, it just cannot be meaningful.
   */
  async generateSku(input: { subCategoryId?: string; brand?: string; model?: string } = {}): Promise<{ sku: string }> {
    let category: string | undefined;
    if (input.subCategoryId) {
      const sub = await this.prisma.subCategory.findFirst({
        where: { id: input.subCategoryId },
        select: { name: true },
      });
      category = sub?.name;
    }

    const prefix = buildSkuPrefix({ category, brand: input.brand, model: input.model });
    if (!prefix) return this.randomSku();

    const siblings = await this.prisma.product.findMany({
      where: { sku: { startsWith: `${prefix}-` } },
      select: { sku: true },
    });

    // The counter is derived from SKUs already using this prefix, so it is
    // normally free on the first try. The loop covers a hand-typed SKU sitting
    // on the number that would come next.
    let sequence = nextSkuSequence(siblings.map((p) => p.sku), prefix);
    for (let attempt = 0; attempt < 50; attempt++, sequence++) {
      const sku = formatSku(prefix, sequence);
      const taken = await this.prisma.product.findFirst({ where: { sku }, select: { id: true } });
      if (!taken) return { sku };
    }
    return this.randomSku();
  }

  /** The original unambiguous-alphabet code, kept for products with nothing to describe them. */
  private async randomSku(length = 6): Promise<{ sku: string }> {
    const alphabet = ProductsService.SKU_ALPHABET;
    for (let attempt = 0; attempt < 10; attempt++) {
      const sku = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
      const taken = await this.prisma.product.findFirst({ where: { sku }, select: { id: true } });
      if (!taken) return { sku };
    }
    throw new BadRequestException('Could not generate a unique SKU, please try again');
  }

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

  async restore(userId: string, id: string) {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Product not found');
    if (!row.deletedAt) return { success: true, alreadyActive: true };
    await this.prisma.product.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    await this.audit.log(userId, 'RESTORE', 'Product', id);
    return { success: true, alreadyActive: false };
  }

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

    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(userId, 'PURGE', 'Product', id);
    return { success: true, mode: 'PURGED', usedBy: {} };
  }

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
    return this.prisma.priceHistory.findMany({
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
