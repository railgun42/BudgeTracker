import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CategoryDto } from '@budgetracker/shared';
import { AdminUpdateCategoryDto, CreateCategoryDto } from '../categories/categories.dto';
import { toCategoryDto } from '../categories/categories.service';
import { AdminGuard } from '../common/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminCategoriesService } from './categories.service';

// Catégories globales (SPEC §13.3), archivées comprises. Pas de DELETE : une globale s'archive.
@Controller('v1/admin/categories')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  async list(): Promise<CategoryDto[]> {
    return (await this.categories.list()).map(toCategoryDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.create(id, dto));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.update(user.id, id, dto));
  }
}
