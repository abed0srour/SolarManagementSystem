import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { isUnused, SafeDeleteResult, usedBy } from '../common/safe-delete';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.category.findMany({ relationLoadStrategy: 'join',
      where: { deletedAt: null },
      include: {
        subCategories: {
          where: { deletedAt: null },
          include: { attributeDefs: { orderBy: { sortOrder: 'asc' } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(userId: string, data: { name: string; description?: string }) {
    const cat = await this.prisma.category.create({ data });
    await this.audit.log(userId, 'CREATE', 'Category', cat.id, { name: cat.name });
    return cat;
  }

  async updateCategory(userId: string, id: string, data: { name?: string; description?: string }) {
    const cat = await this.prisma.category.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'Category', id, data);
    return cat;
  }

  /**
   * Delete a category: permanently when no sub-category row has ever pointed at
   * it, otherwise archived. See `common/safe-delete.ts`.
   *
   * Two different counts on purpose — the guard below rejects the delete when
   * *live* sub-categories exist, while the purge decision counts every row
   * including soft-deleted ones, because those still hold a foreign key and
   * would make a real delete fail.
   */
  async deleteCategory(userId: string, id: string): Promise<SafeDeleteResult> {
    const subCount = await this.prisma.subCategory.count({ where: { categoryId: id, deletedAt: null } });
    if (subCount > 0) throw new BadRequestException('Category has sub-categories; delete or move them first');

    const archivedSubs = await this.prisma.subCategory.count({ where: { categoryId: id } });
    if (isUnused({ subCategories: archivedSubs })) {
      await this.prisma.category.delete({ where: { id } });
      await this.audit.log(userId, 'PURGE', 'Category', id);
      return { success: true, mode: 'PURGED', usedBy: {} };
    }
    const used = usedBy({ subCategories: archivedSubs });
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Category', id, { usedBy: used });
    return { success: true, mode: 'ARCHIVED', usedBy: used };
  }

  async createSubCategory(userId: string, data: { categoryId: string; name: string; description?: string }) {
    // (categoryId, name) is unique — a soft-deleted row with the same name would
    // otherwise block re-creation with a cryptic P2002 error.
    const existing = await this.prisma.subCategory.findUnique({
      where: { categoryId_name: { categoryId: data.categoryId, name: data.name } },
    });
    if (existing && !existing.deletedAt)
      throw new BadRequestException(`A sub-category named "${data.name}" already exists in this category`);
    if (existing) {
      const restored = await this.prisma.subCategory.update({
        where: { id: existing.id },
        data: { deletedAt: null, description: data.description },
      });
      await this.audit.log(userId, 'RESTORE', 'SubCategory', restored.id, { name: restored.name });
      return restored;
    }
    const sub = await this.prisma.subCategory.create({ data });
    await this.audit.log(userId, 'CREATE', 'SubCategory', sub.id, { name: sub.name });
    return sub;
  }

  async updateSubCategory(userId: string, id: string, data: { name?: string; description?: string }) {
    const sub = await this.prisma.subCategory.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'SubCategory', id, data);
    return sub;
  }

  /**
   * Delete a sub-category: permanently when no product row has ever pointed at
   * it, otherwise archived. Attribute definitions cascade with it, so they do
   * not count as usage. See the note in `deleteCategory` about the two counts.
   */
  async deleteSubCategory(userId: string, id: string): Promise<SafeDeleteResult> {
    const productCount = await this.prisma.product.count({ where: { subCategoryId: id, deletedAt: null } });
    if (productCount > 0) throw new BadRequestException('Sub-category has products; move them first');

    const archivedProducts = await this.prisma.product.count({ where: { subCategoryId: id } });
    if (isUnused({ products: archivedProducts })) {
      await this.prisma.subCategory.delete({ where: { id } });
      await this.audit.log(userId, 'PURGE', 'SubCategory', id);
      return { success: true, mode: 'PURGED', usedBy: {} };
    }
    const used = usedBy({ products: archivedProducts });
    await this.prisma.subCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'SubCategory', id, { usedBy: used });
    return { success: true, mode: 'ARCHIVED', usedBy: used };
  }

  async createAttribute(
    userId: string,
    data: {
      subCategoryId: string;
      name: string;
      label: string;
      type?: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'SELECT';
      unit?: string;
      options?: string[];
      required?: boolean;
      sortOrder?: number;
    },
  ) {
    const sub = await this.prisma.subCategory.findUnique({ where: { id: data.subCategoryId } });
    if (!sub) throw new NotFoundException('Sub-category not found');
    const attr = await this.prisma.attributeDefinition.create({
      data: { ...data, options: data.options ?? undefined },
    });
    await this.audit.log(userId, 'CREATE', 'AttributeDefinition', attr.id, { name: attr.name });
    return attr;
  }

  async updateAttribute(userId: string, id: string, data: any) {
    const attr = await this.prisma.attributeDefinition.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'AttributeDefinition', id, data);
    return attr;
  }

  async deleteAttribute(userId: string, id: string) {
    await this.prisma.attributeDefinition.delete({ where: { id } });
    await this.audit.log(userId, 'DELETE', 'AttributeDefinition', id);
    return { success: true };
  }
}
