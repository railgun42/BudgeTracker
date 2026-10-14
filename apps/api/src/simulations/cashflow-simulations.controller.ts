import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CASHFLOW_LIMITS,
  CashflowDto,
  CashflowSimulationDto,
  CreateCashflowSimulationInput,
  LocalDate,
  UpdateCashflowSimulationInput,
} from '@budgetracker/shared';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CashflowSimulationsService, toCashflowSimulationDto } from './cashflow-simulations.service';
import { CashflowParamsDto } from './simulations.controller';

const trim = ({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value);

class CreateCashflowSimulationDto implements CreateCashflowSimulationInput {
  @Transform(trim)
  @IsString()
  @Length(1, CASHFLOW_LIMITS.maxNameLength)
  name!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => CashflowParamsDto)
  params!: CashflowParamsDto;

  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

class UpdateCashflowSimulationDto implements UpdateCashflowSimulationInput {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, CASHFLOW_LIMITS.maxNameLength)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CashflowParamsDto)
  params?: CashflowParamsDto;

  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

class TodayQueryDto {
  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

@Controller('v1/cashflow-simulations')
@UseGuards(JwtAuthGuard)
export class CashflowSimulationsController {
  constructor(private readonly simulations: CashflowSimulationsService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<CashflowSimulationDto[]> {
    return (await this.simulations.list(id)).map(toCashflowSimulationDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() { name, params, today }: CreateCashflowSimulationDto): Promise<CashflowSimulationDto> {
    return toCashflowSimulationDto(await this.simulations.create(id, name, params, today));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CashflowSimulationDto> {
    return toCashflowSimulationDto(await this.simulations.get(user.id, id));
  }

  // Résultat au jour `today` (défaut : jour du serveur) avec les vraies dépenses ; rien n'est écrit.
  @Get(':id/result')
  result(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() { today }: TodayQueryDto): Promise<CashflowDto> {
    return this.simulations.result(user.id, id, today);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { version, name, params, today }: UpdateCashflowSimulationDto,
  ): Promise<CashflowSimulationDto> {
    return toCashflowSimulationDto(await this.simulations.update(user.id, id, version, name, params, today));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.simulations.remove(user.id, id);
  }
}
