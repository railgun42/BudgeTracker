import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  addMonths,
  CashflowDto,
  CashflowInput,
  IntervalUnit,
  LocalDate,
  ProjectionDto,
  ProjectionQuery,
  SavingsGoalDto,
  SavingsGoalQuery,
  SIMULATION_LIMITS,
  TrackingType,
  TransactionType,
} from '@budgetracker/shared';
import { balanceSql } from '../balance/balance.service';
import { PrismaService } from '../prisma/prisma.service';
import { todayUtc } from '../recurrences/recurrences.service';
import { toDate, toLocalDate } from '../transactions/transactions.service';
import { cashflow, type CashflowLine } from './engine/cashflow';
import { projection, type ProjectionInput } from './engine/projection';
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

  async projection(userId: string, query: ProjectionQuery): Promise<ProjectionDto> {
    return projection(await this.projectionInput(userId, query));
  }

  // Entrée du moteur de projection ; réutilisée par les scénarios (copie virtuelle).
  async projectionInput(userId: string, { accountId, months, windowMonths = 3, today = todayUtc() }: ProjectionQuery): Promise<ProjectionInput> {
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
    return {
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
    };
  }

  // Simulation de trésorerie (SPEC §6.2) : comptes de l'utilisateur seulement ; rien n'est écrit.
  async cashflow(
    userId: string,
    { accountIds, endDate, excludedRecurrenceIds = [], extraRecurrences = [], oneOffs = [], today = todayUtc(), startDate = today }: CashflowInput,
  ): Promise<CashflowDto> {
    if (startDate < today) throw new BadRequestException('La date de début ne peut pas précéder aujourd’hui');
    if (endDate < startDate) throw new BadRequestException('La date de fin précède la date de début');
    if (endDate > addMonths(today, SIMULATION_LIMITS.maxMonths)) throw new BadRequestException('Période trop longue');
    const balances = await Promise.all(accountIds.map((id) => this.currentBalance(userId, id, today)));
    const own = { userId, accountId: { in: accountIds }, deletedAt: null };
    const [recurrences, planned] = await Promise.all([
      this.prisma.recurrence.findMany({ where: own, include: { template: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      // Comme la projection : occurrences de récurrence exclues ici, projetées par le moteur.
      this.prisma.transaction.findMany({
        where: { ...own, recurrenceId: null, date: { gt: toDate(today), lte: toDate(endDate) } },
        select: { id: true, name: true, date: true, type: true, amountCents: true, transferId: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const excluded = new Set(excludedRecurrenceIds);
    if (excluded.size > recurrences.filter((r) => excluded.has(r.id)).length) throw new NotFoundException('Récurrence introuvable');
    // Virement entre deux comptes simulés : les deux jambes s'annulent, elles sont retirées du détail.
    const legs = new Map<string, number>();
    for (const { transferId } of planned) if (transferId) legs.set(transferId, (legs.get(transferId) ?? 0) + 1);

    const lines: CashflowLine[] = [
      ...recurrences.map((r) => ({
        source: 'RECURRENCE' as const,
        id: r.id,
        name: r.template!.name,
        type: r.template!.type as TransactionType,
        amountCents: Number(r.template!.amountCents),
        included: !excluded.has(r.id),
        rule: { startDate: toLocalDate(r.startDate), endDate: r.endDate && toLocalDate(r.endDate), interval: r.interval, unit: r.unit as IntervalUnit },
      })),
      ...extraRecurrences.map(({ name, type, amountCents, endDate = null, ...rule }) => ({
        source: 'EXTRA_RECURRENCE' as const,
        id: null,
        name,
        type,
        amountCents,
        included: true,
        rule: { ...rule, endDate },
      })),
      ...oneOffs.map(({ name, type, amountCents, date }) => ({ source: 'ONE_OFF' as const, id: null, name, type, amountCents, included: true, date })),
      ...planned
        .filter((t) => !t.transferId || legs.get(t.transferId) === 1)
        .map((t) => ({
          source: 'PLANNED' as const,
          id: t.id,
          name: t.name,
          type: t.type as TransactionType,
          amountCents: Number(t.amountCents),
          included: true,
          date: toLocalDate(t.date),
        })),
    ];
    return cashflow({ today, startDate, endDate, balanceCents: balances.reduce((sum, b) => sum + b, 0), lines });
  }

  async savingsGoal(userId: string, { targetCents, months, accountId, today = todayUtc() }: SavingsGoalQuery): Promise<SavingsGoalDto> {
    const savedCents = accountId ? await this.currentBalance(userId, accountId, today) : 0;
    return savingsGoal({ targetCents, months, savedCents });
  }
}
