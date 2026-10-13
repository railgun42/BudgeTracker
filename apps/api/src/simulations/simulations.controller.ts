import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  InvestmentQuery,
  InvestmentResultDto,
  LoanQuery,
  LoanResultDto,
  LocalDate,
  ProjectionDto,
  ProjectionQuery,
  SavingsGoalDto,
  SavingsGoalQuery,
  SIMULATION_LIMITS,
} from '@budgetracker/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { investment } from './engine/investment';
import { loan } from './engine/loan';
import { SimulationsService } from './simulations.service';

const { maxAmountCents, maxMonthlyCents, maxRateBp, maxMonths } = SIMULATION_LIMITS;

export class LoanQueryDto implements LoanQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxAmountCents)
  principalCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(maxRateBp)
  annualRateBp!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxMonths)
  months!: number;
}

export class InvestmentQueryDto implements InvestmentQuery {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(maxAmountCents)
  initialCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(maxMonthlyCents)
  monthlyContributionCents?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(maxRateBp)
  annualRateBp!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxMonths)
  months!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(maxRateBp)
  inflationBp?: number;
}

export class ProjectionQueryDto implements ProjectionQuery {
  @IsUUID()
  accountId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxMonths)
  months!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxMonths)
  windowMonths?: number;

  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

export class SavingsGoalQueryDto implements SavingsGoalQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxAmountCents)
  targetCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(maxMonths)
  months!: number;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

// Calculateurs (SPEC §6.4) : aucun accès BDD ni aux transactions ; session requise comme le reste de l'app.
// Projection et objectif d'épargne (SPEC §6.1, §6.3) : lecture des données du compte, calcul par les moteurs purs.
@Controller('v1/simulations')
@UseGuards(JwtAuthGuard)
export class SimulationsController {
  constructor(private readonly simulations: SimulationsService) {}

  @Get('loan')
  loan(@Query() query: LoanQueryDto): LoanResultDto {
    return loan(query);
  }

  @Get('investment')
  investment(@Query() query: InvestmentQueryDto): InvestmentResultDto {
    return investment(query);
  }

  @Get('projection')
  projection(@CurrentUser() user: AuthUser, @Query() query: ProjectionQueryDto): Promise<ProjectionDto> {
    return this.simulations.projection(user.id, query);
  }

  @Get('savings-goal')
  savingsGoal(@CurrentUser() user: AuthUser, @Query() query: SavingsGoalQueryDto): Promise<SavingsGoalDto> {
    return this.simulations.savingsGoal(user.id, query);
  }
}
