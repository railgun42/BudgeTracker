import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  AllowancePeriod,
  CASHFLOW_LIMITS,
  CashflowDto,
  CashflowFloorInput,
  CashflowInput,
  CashflowOneOffInput,
  CashflowRecurrenceInput,
  IntervalUnit,
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
  TransactionType,
} from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { investment } from './engine/investment';
import { loan } from './engine/loan';
import { SimulationsService } from './simulations.service';

const { maxAmountCents, maxMonthlyCents, maxRateBp, maxMonths } = SIMULATION_LIMITS;
const { maxAccounts, maxExtraRecurrences, maxOneOffs, maxNameLength } = CASHFLOW_LIMITS;
const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

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

class CashflowOneOffDto implements CashflowOneOffInput {
  @Transform(trim)
  @IsString()
  @Length(1, maxNameLength)
  name!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsInt()
  @Min(1)
  @Max(maxMonthlyCents)
  amountCents!: number;

  @IsLocalDate()
  date!: LocalDate;
}

class CashflowRecurrenceDto implements CashflowRecurrenceInput {
  @Transform(trim)
  @IsString()
  @Length(1, maxNameLength)
  name!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsInt()
  @Min(1)
  @Max(maxMonthlyCents)
  amountCents!: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  interval!: number;

  @IsEnum(IntervalUnit)
  unit!: IntervalUnit;

  @IsLocalDate()
  startDate!: LocalDate;

  @IsOptional()
  @IsLocalDate()
  endDate?: LocalDate | null;
}

class CashflowFloorDto implements CashflowFloorInput {
  @IsInt()
  @Min(-maxAmountCents)
  @Max(maxAmountCents)
  floorCents!: number;

  @IsIn(['MONTH', 'WEEK'])
  period!: AllowancePeriod;
}

// Paramètres d'une simulation de trésorerie, partagés par l'appel direct et la sauvegarde (E34).
export class CashflowParamsDto implements Omit<CashflowInput, 'today'> {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maxAccounts)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds!: string[];

  @IsOptional()
  @IsLocalDate()
  startDate?: LocalDate;

  @IsLocalDate()
  endDate!: LocalDate;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  excludedRecurrenceIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(maxExtraRecurrences)
  @ValidateNested({ each: true })
  @Type(() => CashflowRecurrenceDto)
  extraRecurrences?: CashflowRecurrenceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(maxOneOffs)
  @ValidateNested({ each: true })
  @Type(() => CashflowOneOffDto)
  oneOffs?: CashflowOneOffDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CashflowFloorDto)
  floor?: CashflowFloorDto;
}

export class CashflowBodyDto extends CashflowParamsDto implements CashflowInput {
  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

// Calculateurs (SPEC §6.4) : aucun accès BDD ni aux transactions ; session requise comme le reste de l'app.
// Projection, objectif d'épargne et trésorerie (SPEC §6.1 à §6.3) : lecture des données du compte, calcul par les moteurs purs.
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

  // POST : l'entrée (listes de récurrences et de ponctuelles) ne tient pas dans une query. Rien n'est écrit.
  @Post('cashflow')
  @HttpCode(200)
  cashflow(@CurrentUser() user: AuthUser, @Body() body: CashflowBodyDto): Promise<CashflowDto> {
    return this.simulations.cashflow(user.id, body);
  }

  @Get('savings-goal')
  savingsGoal(@CurrentUser() user: AuthUser, @Query() query: SavingsGoalQueryDto): Promise<SavingsGoalDto> {
    return this.simulations.savingsGoal(user.id, query);
  }
}
