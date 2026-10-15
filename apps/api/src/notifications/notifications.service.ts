import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationDto, NotificationsDto, SentMessageDto } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ponytail: 100 dernières de chaque sorte, sans pagination ni purge ; paginer si les annonces s'accumulent.
const TAKE = 100;

const sent = ({ id, message, createdAt }: { id: string; message: string; createdAt: Date }): SentMessageDto => ({ id, message, createdAt: createdAt.toISOString() });

// Notification personnelle dans la transaction de l'appelant (sert aussi à répondre à une suggestion de catégorie).
// Journal : la notification, jamais le destinataire ni son e-mail.
export async function notifyUser(tx: Prisma.TransactionClient, adminId: string, userId: string, message: string): Promise<SentMessageDto> {
  const notification = await tx.notification.create({ data: { userId, message } });
  await tx.adminAuditLog.create({ data: { adminId, action: 'NOTIFICATION_SENT', targetId: notification.id } });
  return sent(notification);
}

// Notifications (SPEC §13.6) : annonces à tous (lues par utilisateur, visibles des seuls inscrits avant leur création)
// et notifications personnelles (filtrées par userId). Envois réservés à l'admin et journalisés.
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Liste et compteur dans le même instantané : la pastille correspond toujours à la liste.
  list(userId: string): Promise<NotificationsDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const { createdAt: since } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } });
        const visible = { createdAt: { gte: since } };
        const [announcements, personal, unreadAnnouncements, unreadPersonal] = await Promise.all([
          tx.announcement.findMany({ where: visible, include: { reads: { where: { userId }, select: { userId: true } } }, orderBy: { createdAt: 'desc' }, take: TAKE }),
          tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: TAKE }),
          tx.announcement.count({ where: { ...visible, reads: { none: { userId } } } }),
          tx.notification.count({ where: { userId, readAt: null } }),
        ]);
        const items: NotificationDto[] = [
          ...announcements.map((a) => ({ id: a.id, kind: 'ANNOUNCEMENT' as const, message: a.message, createdAt: a.createdAt.toISOString(), read: a.reads.length > 0 })),
          ...personal.map((n) => ({ id: n.id, kind: 'PERSONAL' as const, message: n.message, createdAt: n.createdAt.toISOString(), read: n.readAt !== null })),
        ];
        // Non lues d'abord, puis les plus récentes (ISO UTC : ordre lexical = ordre chronologique).
        items.sort((x, y) => Number(x.read) - Number(y.read) || y.createdAt.localeCompare(x.createdAt) || x.id.localeCompare(y.id));
        return { unreadCount: unreadAnnouncements + unreadPersonal, items };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  // Idempotent. Notification d'un autre utilisateur ou annonce antérieure à l'inscription ⇒ 404.
  async markRead(userId: string, id: string): Promise<void> {
    const mine = { id, userId };
    if ((await this.prisma.notification.updateMany({ where: { ...mine, readAt: null }, data: { readAt: new Date() } })).count) return;
    if (await this.prisma.notification.count({ where: mine })) return;
    const { createdAt } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } });
    if (!(await this.prisma.announcement.count({ where: { id, createdAt: { gte: createdAt } } }))) throw new NotFoundException();
    await this.prisma.announcementRead.createMany({ data: [{ userId, announcementId: id }], skipDuplicates: true });
  }

  announce(adminId: string, message: string): Promise<SentMessageDto> {
    return this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({ data: { message } });
      await tx.adminAuditLog.create({ data: { adminId, action: 'ANNOUNCEMENT_SENT', targetId: announcement.id } });
      return sent(announcement);
    });
  }

  // Destinataire inconnu ⇒ 404.
  async notify(adminId: string, email: string, message: string): Promise<SentMessageDto> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new NotFoundException('Aucun utilisateur avec cet e-mail');
    return this.prisma.$transaction((tx) => notifyUser(tx, adminId, user.id, message));
  }
}
