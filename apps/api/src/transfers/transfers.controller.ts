import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { TransferDto } from '@budgetracker/shared';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateTransferDto, UpdateTransferDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

// Suppression et restauration : DELETE /transactions/:id et POST /transactions/:id/restore sur une jambe.
@Controller('v1/transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  create(@CurrentUser() { id }: AuthUser, @Body() dto: CreateTransferDto): Promise<TransferDto> {
    return this.transfers.create(id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransferDto> {
    return this.transfers.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransferDto): Promise<TransferDto> {
    return this.transfers.update(user.id, id, dto);
  }
}
