import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SentMessageDto } from '@budgetracker/shared';
import { AdminGuard } from '../common/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateAnnouncementDto, CreateNotificationDto } from '../notifications/notifications.dto';
import { NotificationsService } from '../notifications/notifications.service';

// Communication administrateur → utilisateurs (SPEC §13.6). Une annonce ne remplace pas l'e-mail RGPD (CGU).
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('announcements')
  announce(@CurrentUser() { id }: AuthUser, @Body() { message }: CreateAnnouncementDto): Promise<SentMessageDto> {
    return this.notifications.announce(id, message);
  }

  @Post('notifications')
  notify(@CurrentUser() { id }: AuthUser, @Body() { email, message }: CreateNotificationDto): Promise<SentMessageDto> {
    return this.notifications.notify(id, email, message);
  }
}
