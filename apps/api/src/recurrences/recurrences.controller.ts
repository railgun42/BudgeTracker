import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RecurrenceDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateRecurrenceDto, UpdateRecurrenceDto } from './recurrences.dto';
import { RecurrencesService, toRecurrenceDto, todayUtc } from './recurrences.service';

// Une occurrence générée est une transaction ordinaire : édition et suppression isolées via /transactions/:id.
@Controller('v1/recurrences')
@UseGuards(JwtAuthGuard)
export class RecurrencesController {
  constructor(private readonly recurrences: RecurrencesService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<RecurrenceDto[]> {
    return (await this.recurrences.list(id)).map(toRecurrenceDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateRecurrenceDto): Promise<RecurrenceDto> {
    return toRecurrenceDto(await this.recurrences.create(id, dto, todayUtc()));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<RecurrenceDto> {
    return toRecurrenceDto(await this.recurrences.get(user.id, id));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurrenceDto): Promise<RecurrenceDto> {
    return toRecurrenceDto(await this.recurrences.update(user.id, id, dto, todayUtc()));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.recurrences.remove(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<RecurrenceDto> {
    return toRecurrenceDto(await this.recurrences.restore(user.id, id));
  }
}
