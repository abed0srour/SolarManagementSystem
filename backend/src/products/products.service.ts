import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

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
    sortBy?: string;
    sortDir?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.ProductWhereInput = { deletedAt: null };
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
      this.prisma.product.findMany({
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
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(userId: string, data: any) {
    const product = await this.prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        brand: data.brand,
        model: data.model,
        subCategoryId: data.subCategoryId,
        attributes: data.attributes ?? {},
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        taxRatePct: data.taxRatePct ?? 0,
        trackSerials: data.trackSerials ?? true,
        lowStockThreshold: data.lowStockThreshold ?? 5,
        warrantyMonths: data.warrantyMonths,
        performanceWarrantyMonths: data.performanceWarrantyMonths,
        shelfLifeMonths: data.shelfLifeMonths,
        barcode: data.barcode,
        notes: data.notes,
      },
    });
    await this.prisma.priceHistory.create({
      data: {
        productId: product.id,
        newCostPrice: data.costPrice,
        newSalePrice: data.salePrice,
        reason: 'Initial price',
        changedById: userId,
      },
    });
    await this.audit.log(userId, 'CREATE', 'Product', product.id, { sku: product.sku, name: product.name });
    return product;
  }

  async update(userId: string, id: string, data: any) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');

    const priceChanged =
      (data.costPrice !== undefined && Number(data.costPrice) !== Number(existing.costPrice)) ||
      (data.salePrice !== undefined && Number(data.salePrice) !== Number(existing.salePrice));

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        sku: data.sku,
        name: data.name,
        brand: data.brand,
        model: data.model,
        subCategoryId: data.subCategoryId,
        attributes: data.attributes,
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        taxRatePct: data.taxRatePct,
        trackSerials: data.trackSerials,
        lowStockThreshold: data.lowStockThreshold,
        warrantyMonths: data.warrantyMonths,
        performanceWarrantyMonths: data.performanceWarrantyMonths,
        shelfLifeMonths: data.shelfLifeMonths,
        barcode: data.barcode,
        notes: data.notes,
        isActive: data.isActive,
        ...(priceChanged ? { priceUpdatedAt: new Date() } : {}),
      },
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
      const product = await this.prisma.product.findUnique({ where: { sku: row.sku } });
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

  /** Soft delete — the product stays referenced by past invoices/orders but disappears from lists. */
  async remove(userId: string, id: string) {
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log(userId, 'DELETE', 'Product', id);
    return { success: true };
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
