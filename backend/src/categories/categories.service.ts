import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.category.findMany({
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

  async deleteCategory(userId: string, id: string) {
    const subCount = await this.prisma.subCategory.count({ where: { categoryId: id, deletedAt: null } });
    if (subCount > 0) throw new BadRequestException('Category has sub-categories; delete or move them first');
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Category', id);
    return { success: true };
  }

  async createSubCategory(userId: string, data: { categoryId: string; name: string; description?: string }) {
    const sub = await this.prisma.subCategory.create({ data });
    await this.audit.log(userId, 'CREATE', 'SubCategory', sub.id, { name: sub.name });
    return sub;
  }

  async updateSubCategory(userId: string, id: string, data: { name?: string; description?: string }) {
    const sub = await this.prisma.subCategory.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'SubCategory', id, data);
    return sub;
  }

  async deleteSubCategory(userId: string, id: string) {
    const productCount = await this.prisma.product.count({ where: { subCategoryId: id, deletedAt: null } });
    if (productCount > 0) throw new BadRequestException('Sub-category has products; move them first');
    await this.prisma.subCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'SubCategory', id);
    return { success: true };
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
