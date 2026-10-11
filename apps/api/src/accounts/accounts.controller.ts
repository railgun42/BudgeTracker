import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';
import { AccountsService, toAccountDto } from './accounts.service';

@Controller('v1/accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  async list(@CurrentUser() { id }: AuthUser): Promise<AccountDto[]> {
    return (await this.accounts.list(id)).map(toAccountDto);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateAccountDto): Promise<AccountDto> {
    return toAccountDto(await this.accounts.create(id, dto));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AccountDto> {
    return toAccountDto(await this.accounts.get(user.id, id));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto): Promise<AccountDto> {
    return toAccountDto(await this.accounts.update(user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.accounts.remove(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AccountDto> {
    return toAccountDto(await this.accounts.restore(user.id, id));
  }
}
