import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { AdminFeedbackDto, FEEDBACK_LIMITS, FEEDBACK_RETENTION, FeedbackDto, FeedbackType } from '@budgetracker/shared';
import { Feedback, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminFeedbackQueryDto, CreateFeedbackDto } from './feedback.dto';

const DAY_MS = 86_400_000;

export const toFeedbackDto = ({ id, type, message, treatedAt, createdAt }: Feedback): FeedbackDto => ({
  id,
  type: type as FeedbackType,
  message,
  status: treatedAt ? 'TREATED' : 'NEW',
  createdAt: createdAt.toISOString(),
  treatedAt: treatedAt?.toISOString() ?? null,
});

// Échéance de la purge (jobs/purge.job.ts) : 30 j après le traitement, 90 j après la création sinon.
export function toAdminFeedbackDto(feedback: Feedback, now = new Date()): AdminFeedbackDto {
  const { afterTreatedDays, untreatedDays, warnDays } = FEEDBACK_RETENTION;
  const { treatedAt, createdAt } = feedback;
  const expiresAt = treatedAt ? treatedAt.getTime() + afterTreatedDays * DAY_MS : createdAt.getTime() + untreatedDays * DAY_MS;
  return { ...toFeedbackDto(feedback), expiresAt: new Date(expiresAt).toISOString(), expiringSoon: !treatedAt && expiresAt - now.getTime() <= warnDays * DAY_MS };
}

const ORDER: Record<AdminFeedbackQueryDto['sort'], Prisma.FeedbackOrderByWithRelationInput[]> = {
  date: [{ createdAt: 'desc' }, { id: 'asc' }],
  type: [{ type: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
  // Nouveaux d'abord.
  status: [{ treatedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'asc' }],
};

// Retours utilisateurs (SPEC §13.5). Côté utilisateur : ses seuls retours. Côté admin : tous, sans auteur.
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<Feedback[]> {
    return this.prisma.feedback.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
  }

  // Verrou consultatif par utilisateur : deux envois simultanés ne dépassent pas les limites.
  create(userId: string, { type, message }: CreateFeedbackDto, now = new Date()): Promise<Feedback> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`feedback:${userId}`}::text, 0))`;
      const [lastDay, untreated] = await Promise.all([
        tx.feedback.count({ where: { userId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
        tx.feedback.count({ where: { userId, treatedAt: null } }),
      ]);
      const { perDay, maxUntreated } = FEEDBACK_LIMITS;
      if (lastDay >= perDay) throw new HttpException(`${perDay} retours par 24 h au plus`, HttpStatus.TOO_MANY_REQUESTS);
      if (untreated >= maxUntreated) throw new HttpException(`${maxUntreated} retours en attente de traitement au plus`, HttpStatus.TOO_MANY_REQUESTS);
      return tx.feedback.create({ data: { userId, type, message } });
    });
  }

  // ponytail: 500 lignes max, sans pagination ; la purge borne la boîte (90 j, 20 en attente par utilisateur).
  adminList({ type, status, sort }: AdminFeedbackQueryDto): Promise<Feedback[]> {
    const treatedAt = status === 'NEW' ? null : status === 'TREATED' ? { not: null } : undefined;
    return this.prisma.feedback.findMany({ where: { type, treatedAt }, orderBy: ORDER[sort], take: 500 });
  }

  // Idempotent : un retour déjà traité garde sa date de traitement et n'est pas journalisé deux fois.
  treat(adminId: string, id: string): Promise<Feedback> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.feedback.updateMany({ where: { id, treatedAt: null }, data: { treatedAt: new Date() } });
      if (count) await tx.adminAuditLog.create({ data: { adminId, action: 'FEEDBACK_TREATED', targetId: id } });
      const feedback = await tx.feedback.findUnique({ where: { id } });
      if (!feedback) throw new NotFoundException();
      return feedback;
    });
  }
}
