import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CreateInterestRateInput, InterestRateDto, InterestRatesDto, LocalDate } from '@budgetracker/shared';
import { IsInt, Max, Min } from 'class-validator';
import { IsLocalDate } from '../common/is-local-date';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { todayUtc } from '../recurrences/recurrences.service';
import { InterestService } from './interest.service';

export class CreateInterestRateDto implements CreateInterestRateInput {
  // Points de base : 325 = 3,25 %.
  @IsInt()
  @Min(0)
  @Max(10_000)
  rateBp!: number;

  @IsLocalDate()
  effectiveDate!: LocalDate;
}

@Controller('v1/accounts')
@UseGuards(JwtAuthGuard)
export class InterestController {
  constructor(private readonly interest: InterestService) {}

  @Get(':id/interest-rates')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<InterestRatesDto> {
    return this.interest.list(user.id, id, todayUtc());
  }

  @Post(':id/interest-rates')
  set(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInterestRateDto): Promise<InterestRateDto> {
    return this.interest.set(user.id, id, dto);
  }
}
