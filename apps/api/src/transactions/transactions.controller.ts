import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TransactionDto, TransactionPage } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateTransactionDto, TransactionListQueryDto, UpdateTransactionDto } from './transactions.dto';
import { TransactionsService, toTransactionDto } from './transactions.service';

@Controller('v1/transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(@CurrentUser() { id }: AuthUser, @Query() query: TransactionListQueryDto): Promise<TransactionPage> {
    return this.transactions.list(id, query);
  }

  @Post()
  async create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateTransactionDto): Promise<TransactionDto> {
    return toTransactionDto(await this.transactions.create(id, dto));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransactionDto> {
    return toTransactionDto(await this.transactions.get(user.id, id));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransactionDto): Promise<TransactionDto> {
    return toTransactionDto(await this.transactions.update(user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.transactions.remove(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransactionDto> {
    return toTransactionDto(await this.transactions.restore(user.id, id));
  }
}
