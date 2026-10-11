import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AccountBalanceDto, LocalDate } from '@budgetracker/shared';
import { IsOptional } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { BalanceService } from './balance.service';

export class BalanceQueryDto {
  // Jour du client : évite le décalage de fuseau autour de minuit.
  @IsOptional()
  @IsLocalDate()
  today?: LocalDate;
}

@Controller('v1/accounts')
@UseGuards(JwtAuthGuard)
export class BalanceController {
  constructor(private readonly balance: BalanceService) {}

  @Get(':id/balance')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() { today }: BalanceQueryDto): Promise<AccountBalanceDto> {
    return this.balance.get(user.id, id, today ?? new Date().toISOString().slice(0, 10));
  }
}
