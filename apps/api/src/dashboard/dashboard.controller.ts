import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import {
  BalanceSeriesDto,
  DASHBOARD_BLOCKS,
  DASHBOARD_LIMITS,
  DASHBOARD_PERIODS,
  DashboardBlock,
  DashboardPeriod,
  DashboardPreferencesDto,
  LocalDate,
  UpcomingOccurrenceDto,
  UpdateDashboardPreferencesInput,
} from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { todayUtc } from '../recurrences/recurrences.service';
import { DashboardService } from './dashboard.service';

const { maxAccountIds, maxUpcomingDays } = DASHBOARD_LIMITS;

export class DashboardPreferencesBodyDto implements UpdateDashboardPreferencesInput {
  @IsInt()
  @Min(0)
  version!: number;

  @IsIn([...DASHBOARD_PERIODS])
  period!: DashboardPeriod;

  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(maxAccountIds)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds!: string[] | null;

  @IsArray()
  @ArrayMaxSize(maxAccountIds)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  curveAccountIds!: string[];

  @IsBoolean()
  curveTotal!: boolean;

  @IsArray()
  @ArrayUnique()
  @IsIn([...DASHBOARD_BLOCKS], { each: true })
  hiddenBlocks!: DashboardBlock[];
}

// ?accountIds=id1,id2
export class BalanceSeriesQueryDto {
  @IsLocalDate()
  from!: LocalDate;

  @IsLocalDate()
  to!: LocalDate;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maxAccountIds)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds?: string[];
}

export class UpcomingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxUpcomingDays)
  days: number = 7;

  // Jour du client : évite le décalage de fuseau autour de minuit.
  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

@Controller('v1/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('preferences')
  getPreferences(@CurrentUser() { id }: AuthUser): Promise<DashboardPreferencesDto> {
    return this.dashboard.getPreferences(id);
  }

  @Put('preferences')
  putPreferences(@CurrentUser() { id }: AuthUser, @Body() body: DashboardPreferencesBodyDto): Promise<DashboardPreferencesDto> {
    return this.dashboard.putPreferences(id, body);
  }

  @Get('balance-series')
  balanceSeries(@CurrentUser() { id }: AuthUser, @Query() { from, to, accountIds }: BalanceSeriesQueryDto): Promise<BalanceSeriesDto> {
    return this.dashboard.balanceSeries(id, from, to, accountIds);
  }

  @Get('upcoming')
  upcoming(@CurrentUser() { id }: AuthUser, @Query() { days, today }: UpcomingQueryDto): Promise<UpcomingOccurrenceDto[]> {
    return this.dashboard.upcoming(id, days, today ?? todayUtc());
  }
}
