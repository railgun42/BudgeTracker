import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { addMonths, IntervalUnit, LocalDate, ProjectionDto, ProjectionQuery, SavingsGoalDto, SavingsGoalQuery, TrackingType, TransactionType } from '@budgetracker/shared';
import { balanceSql } from '../balance/balance.service';
import { PrismaService } from '../prisma/prisma.service';
import { todayUtc } from '../recurrences/recurrences.service';
import { toDate, toLocalDate } from '../transactions/transactions.service';
import { projection } from './engine/projection';
import { savingsGoal } from './engine/savings-goal';

const signed = (type: string, amountCents: bigint) => (type === TransactionType.CREDIT ? 1 : -1) * Number(amountCents);

// Lit les données du compte puis délègue aux moteurs purs. Rien n'est écrit.
@Injectable()
export class SimulationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Compte de l'utilisateur, non supprimé (sinon 404), avec un solde (NOT_TRACKED ⇒ 422).
  private async currentBalance(userId: string, accountId: string, today: LocalDate): Promise<number> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId, deletedAt: null } });
    if (!account) throw new NotFoundException('Compte introuvable');
    if (account.trackingType === TrackingType.NOT_TRACKED) throw new UnprocessableEntityException('Compte sans solde');
    const [{ current }] = await this.prisma.$queryRaw<{ current: bigint }[]>(balanceSql(userId, accountId, today));
    return Number(current);
  }

  async projection(userId: string, { accountId, months, windowMonths = 3, today = todayUtc() }: ProjectionQuery): Promise<ProjectionDto> {
    const balanceCents = await this.currentBalance(userId, accountId, today);
    const own = { userId, accountId, deletedAt: null, recurrenceId: null };
    const [spend, planned, recurrences] = await Promise.all([
      // Rythme : dépenses non récurrentes, hors virements et solde de départ, sur ]today − windowMonths, today].
      this.prisma.transaction.aggregate({
        _sum: { amountCents: true },
        where: {
          ...own,
          type: TransactionType.DEBIT,
          transferId: null,
          NOT: { category: { nameKey: 'opening_balance' } },
          date: { gt: toDate(addMonths(today, -windowMonths)), lte: toDate(today) },
        },
      }),
      // Transactions futures saisies à la main. Les occurrences de récurrence sont exclues ici et projetées par le moteur.
      this.prisma.transaction.findMany({
        where: { ...own, date: { gt: toDate(today), lte: toDate(addMonths(today, months)) } },
        select: { date: true, type: true, amountCents: true },
      }),
      this.prisma.recurrence.findMany({ where: { userId, accountId, deletedAt: null }, include: { template: true } }),
    ]);
    return projection({
      today,
      months,
      balanceCents,
      windowMonths,
      windowSpendCents: Number(spend._sum.amountCents ?? 0),
      planned: planned.map((t) => ({ date: toLocalDate(t.date), amountCents: signed(t.type, t.amountCents) })),
      recurrences: recurrences.map((r) => ({
        rule: { startDate: toLocalDate(r.startDate), endDate: r.endDate && toLocalDate(r.endDate), interval: r.interval, unit: r.unit as IntervalUnit },
        amountCents: signed(r.template!.type, r.template!.amountCents),
      })),
    });
  }

  async savingsGoal(userId: string, { targetCents, months, accountId, today = todayUtc() }: SavingsGoalQuery): Promise<SavingsGoalDto> {
    const savedCents = accountId ? await this.currentBalance(userId, accountId, today) : 0;
    return savingsGoal({ targetCents, months, savedCents });
  }
}
