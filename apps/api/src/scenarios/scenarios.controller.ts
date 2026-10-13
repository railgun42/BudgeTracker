import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ScenarioComparisonDto, ScenarioDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CompareScenariosQueryDto, CreateScenarioDto, UpdateScenarioDto } from './scenarios.dto';
import { ScenariosService, toScenarioDto } from './scenarios.service';

@Controller('v1/scenarios')
@UseGuards(JwtAuthGuard)
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<ScenarioDto[]> {
    return (await this.scenarios.list(id)).map(toScenarioDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateScenarioDto): Promise<ScenarioDto> {
    return toScenarioDto(await this.scenarios.create(id, dto));
  }

  // Déclarée avant ':id'.
  @Get('compare')
  compare(@CurrentUser() { id }: AuthUser, @Query() query: CompareScenariosQueryDto): Promise<ScenarioComparisonDto> {
    return this.scenarios.compare(id, query);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ScenarioDto> {
    return toScenarioDto(await this.scenarios.get(user.id, id));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScenarioDto): Promise<ScenarioDto> {
    return toScenarioDto(await this.scenarios.update(user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.scenarios.remove(user.id, id);
  }
}
