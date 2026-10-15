import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CategoryDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CategoryPreferenceDto, CreateCategoryDto, DeleteCategoryQueryDto, UpdateCategoryDto } from './categories.dto';
import { CategoriesService, toCategoryDto } from './categories.service';

@Controller('v1/categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<CategoryDto[]> {
    return (await this.categories.list(id)).map(toCategoryDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.create(id, dto));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.update(user.id, id, dto));
  }

  @Put(':id/preference')
  async setPreference(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CategoryPreferenceDto,
  ): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.setPreference(user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() { reassignTo }: DeleteCategoryQueryDto): Promise<void> {
    return this.categories.remove(user.id, id, reassignTo);
  }
}
