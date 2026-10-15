import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminStatsDto } from '@budgetracker/shared';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminService } from './admin.service';

// Toute route /admin/* : JwtAuthGuard puis AdminGuard (vérifié par le test méta d'isolation).
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats(): Promise<AdminStatsDto> {
    return this.admin.stats();
  }
}
