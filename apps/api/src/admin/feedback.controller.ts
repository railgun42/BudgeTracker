import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AdminFeedbackDto } from '@budgetracker/shared';
import { AdminGuard } from '../common/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminFeedbackQueryDto } from '../feedback/feedback.dto';
import { FeedbackService, toAdminFeedbackDto } from '../feedback/feedback.service';

// Boîte de réception des retours (SPEC §13.5) : filtrable par type et statut, triable ; ni auteur ni e-mail.
@Controller('v1/admin/feedback')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  async list(@Query() query: AdminFeedbackQueryDto): Promise<AdminFeedbackDto[]> {
    const now = new Date();
    return (await this.feedback.adminList(query)).map((f) => toAdminFeedbackDto(f, now));
  }

  @Post(':id/treat')
  @HttpCode(200)
  async treat(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdminFeedbackDto> {
    return toAdminFeedbackDto(await this.feedback.treat(user.id, id));
  }
}
