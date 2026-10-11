import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { TagDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { TagBodyDto } from './tags.dto';
import { TagsService, toTagDto } from './tags.service';

@Controller('v1/tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<TagDto[]> {
    return (await this.tags.list(id)).map(toTagDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() { name }: TagBodyDto): Promise<TagDto> {
    return toTagDto(await this.tags.create(id, name));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() { name }: TagBodyDto): Promise<TagDto> {
    return toTagDto(await this.tags.update(user.id, id, name));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tags.remove(user.id, id);
  }
}
