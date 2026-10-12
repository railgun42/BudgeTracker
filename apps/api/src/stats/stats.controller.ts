import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CategoryStatDto, LocalDate, MonthlyStatDto, StatsQuery, TagStatDto } from '@budgetracker/shared';
import { IsOptional, IsUUID } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { StatsService } from './stats.service';

export class StatsQueryDto implements StatsQuery {
  @IsOptional()
  @IsLocalDate()
  from?: LocalDate;

  @IsOptional()
  @IsLocalDate()
  to?: LocalDate;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

@Controller('v1/stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('by-category')
  byCategory(@CurrentUser() user: AuthUser, @Query() query: StatsQueryDto): Promise<CategoryStatDto[]> {
    return this.stats.byCategory(user.id, query);
  }

  @Get('by-tag')
  byTag(@CurrentUser() user: AuthUser, @Query() query: StatsQueryDto): Promise<TagStatDto[]> {
    return this.stats.byTag(user.id, query);
  }

  @Get('monthly')
  monthly(@CurrentUser() user: AuthUser, @Query() query: StatsQueryDto): Promise<MonthlyStatDto[]> {
    return this.stats.monthly(user.id, query);
  }
}
