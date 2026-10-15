import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CategoryDto, CategorySuggestionDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CategoryPreferenceDto, CreateUserCategoryDto, DeleteCategoryQueryDto, UpdateCategoryDto } from './categories.dto';
import { CategoriesService, toCategoryDto, toSuggestionDto } from './categories.service';

@Controller('v1/categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<CategoryDto[]> {
    return (await this.categories.list(id)).map(toCategoryDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateUserCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.categories.create(id, dto));
  }

  // Ses propres suggestions seulement (SPEC §13.5).
  @Get('suggestions')
  async suggestions(@CurrentUser() { id }: AuthUser): Promise<CategorySuggestionDto[]> {
    return (await this.categories.suggestions(id)).map(toSuggestionDto);
  }

  // En attente ⇒ annulée ; traitée ⇒ « vu » (retirée de la liste). Celle d'un autre ⇒ 404.
  @Delete('suggestions/:id')
  @HttpCode(204)
  removeSuggestion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.removeSuggestion(user.id, id);
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
