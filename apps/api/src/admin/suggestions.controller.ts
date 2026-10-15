import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CategorySuggestionDto } from '@budgetracker/shared';
import { AdminSuggestionQueryDto, ResolveCategorySuggestionDto } from '../categories/categories.dto';
import { toSuggestionDto } from '../categories/categories.service';
import { AdminGuard } from '../common/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminSuggestionsService } from './suggestions.service';

// Suggestions de catégorie globale (SPEC §13.5) : accepter (crée la globale), refuser ou traiter, répondre à l'auteur.
@Controller('v1/admin/category-suggestions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSuggestionsController {
  constructor(private readonly suggestions: AdminSuggestionsService) {}

  @Get()
  async list(@Query() { status }: AdminSuggestionQueryDto): Promise<CategorySuggestionDto[]> {
    return (await this.suggestions.list(status)).map(toSuggestionDto);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveCategorySuggestionDto): Promise<CategorySuggestionDto> {
    return toSuggestionDto(await this.suggestions.resolve(user.id, id, dto));
  }
}
