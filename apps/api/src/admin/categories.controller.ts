import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CategoryDto } from '@budgetracker/shared';
import { AdminUpdateCategoryDto, CreateCategoryDto } from '../categories/categories.dto';
import { toCategoryDto } from '../categories/categories.service';
import { AdminGuard } from '../common/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminCategoriesService } from './categories.service';

// Catégories globales (SPEC §13.3), archivées comprises. Une globale utilisée s'archive ; inutilisée, elle se supprime.
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

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(user.id, id);
  }
}
