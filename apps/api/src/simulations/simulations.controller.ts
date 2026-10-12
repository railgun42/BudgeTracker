import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InvestmentQuery, InvestmentResultDto, LoanQuery, LoanResultDto, SIMULATION_LIMITS } from '@budgetracker/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { investment } from './engine/investment';
import { loan } from './engine/loan';

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

// Calculateurs (SPEC §6.4) : aucun accès BDD ni aux transactions ; session requise comme le reste de l'app.
@Controller('v1/simulations')
@UseGuards(JwtAuthGuard)
export class SimulationsController {
  @Get('loan')
  loan(@Query() query: LoanQueryDto): LoanResultDto {
    return loan(query);
  }

  @Get('investment')
  investment(@Query() query: InvestmentQueryDto): InvestmentResultDto {
    return investment(query);
  }
}
