import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { CategoriesService } from './categories.service';
import { AuthUser, CurrentUser } from '../auth/user.decorator';

class CategoryDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class SubCategoryDto {
  @IsString()
  categoryId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class AttributeDto {
  @IsString()
  subCategoryId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  label: string;

  @IsOptional()
  @IsIn(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT'])
  type?: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'SELECT';

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsArray()
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

@Controller('categories')
export class CategoriesController {
  constructor(private service: CategoriesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CategoryDto) {
    return this.service.createCategory(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<CategoryDto>) {
    return this.service.updateCategory(user.id, id, dto);
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.service.categoryUsage(id);
  }

  @Get('sub/:id/usage')
  subUsage(@Param('id') id: string) {
    return this.service.subCategoryUsage(id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteCategory(user.id, id);
  }

  @Post('sub')
  createSub(@CurrentUser() user: AuthUser, @Body() dto: SubCategoryDto) {
    return this.service.createSubCategory(user.id, dto);
  }

  @Patch('sub/:id')
  updateSub(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<SubCategoryDto>) {
    return this.service.updateSubCategory(user.id, id, { name: dto.name, description: dto.description });
  }

  @Delete('sub/:id')
  removeSub(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteSubCategory(user.id, id);
  }

  @Post('attributes')
  createAttr(@CurrentUser() user: AuthUser, @Body() dto: AttributeDto) {
    return this.service.createAttribute(user.id, dto);
  }

  @Patch('attributes/:id')
  updateAttr(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<AttributeDto>) {
    const { subCategoryId, ...data } = dto;
    return this.service.updateAttribute(user.id, id, data);
  }

  @Delete('attributes/:id')
  removeAttr(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteAttribute(user.id, id);
  }
}
