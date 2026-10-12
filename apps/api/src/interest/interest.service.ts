import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CreateInterestRateInput, InterestRatesDto, LocalDate, TrackingType } from '@budgetracker/shared';
import { InterestRate, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toDate, toLocalDate } from '../transactions/transactions.service';
import { yearlyInterest } from './engine/interest';

const toRateDto = (r: InterestRate) => ({ id: r.id, accountId: r.accountId, rateBp: r.rateBp, effectiveDate: toLocalDate(r.effectiveDate) });

// Le moteur exige un taux en vigueur à la dernière quinzaine de l'année.
const rateDeadline = (year: number): LocalDate => `${year}-12-16`;

// Solde de fin de journée à chaque jour mouvementé jusqu'au 31/12 (somme cumulée SQL, une ligne par jour).
const dailyBalancesSql = (userId: string, accountId: string, until: LocalDate) => Prisma.sql`
  SELECT "date", (SUM(SUM(CASE WHEN "type" = 'CREDIT' THEN "amountCents" ELSE -"amountCents" END)) OVER (ORDER BY "date"))::bigint AS "balance"
  FROM "Transaction"
  WHERE "accountId" = ${accountId}::uuid AND "userId" = ${userId}::uuid AND "deletedAt" IS NULL AND "date" <= ${until}::date
  GROUP BY "date"
  ORDER BY "date"`;

// Verrou consultatif par compte, relâché au COMMIT : deux crédits concurrents se sérialisent.
const lock = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;

@Injectable()
export class InterestService {
  private readonly logger = new Logger(InterestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, accountId: string, today: LocalDate): Promise<InterestRatesDto> {
    const account = await this.account(userId, accountId);
    const rates = await this.prisma.interestRate.findMany({ where: { accountId, userId }, orderBy: { effectiveDate: 'asc' } });
    const deadline = rateDeadline(Number(today.slice(0, 4)));
    return {
      rates: rates.map(toRateDto),
      missingRate: account.trackingType === TrackingType.WITH_INTEREST && !rates.some((r) => toLocalDate(r.effectiveDate) <= deadline),
    };
  }

  // Même date d'effet ⇒ le taux est remplacé (correction de saisie). Les années déjà créditées ne sont pas recalculées.
  async set(userId: string, accountId: string, { rateBp, effectiveDate }: CreateInterestRateInput) {
    const account = await this.account(userId, accountId);
    if (account.trackingType !== TrackingType.WITH_INTEREST) throw new UnprocessableEntityException('Taux réservé aux comptes WITH_INTEREST');
    const date = toDate(effectiveDate);
    const rate = await this.prisma.interestRate.upsert({
      where: { accountId_effectiveDate: { accountId, effectiveDate: date } },
      update: { rateBp },
      create: { userId, accountId, rateBp, effectiveDate: date },
    });
    return toRateDto(rate);
  }

  private async account(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
    if (!account) throw new NotFoundException();
    return account;
  }

  // Job, tous utilisateurs : seule sélection sans filtre userId (comme la purge) ; chaque crédit filtre ensuite par userId.
  async creditAll(today: LocalDate): Promise<number> {
    const accounts = await this.prisma.account.findMany({ where: { trackingType: TrackingType.WITH_INTEREST, deletedAt: null }, select: { id: true, userId: true } });
    let created = 0;
    for (const { id, userId } of accounts) {
      // Un compte en échec ne bloque pas les autres ; il sera repris au prochain passage.
      created += await this.credit(userId, id, today).catch((e: Error) => (this.logger.error(`Intérêts de ${id} : ${e.message}`), 0));
    }
    return created;
  }

  /**
   * Crédite, datée du 31/12, chaque année close (antérieure à `today`) depuis la première transaction et pas encore
   * créditée. Idempotent : InterestCredit unique (accountId, year), sous verrou. Années dans l'ordre : le crédit de
   * l'année N entre dans le solde de N+1. Taux absent ⇒ rien (l'UI le signale via missingRate).
   */
  credit(userId: string, accountId: string, today: LocalDate): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        await lock(tx, accountId);
        const account = await tx.account.findFirst({ where: { id: accountId, userId, deletedAt: null, trackingType: TrackingType.WITH_INTEREST } });
        const first = await tx.transaction.findFirst({ where: { accountId, userId, deletedAt: null }, orderBy: { date: 'asc' }, select: { date: true } });
        if (!account || !first) return 0;
        const rates = (await tx.interestRate.findMany({ where: { accountId, userId } })).map((r) => ({ rateBp: r.rateBp, effectiveDate: toLocalDate(r.effectiveDate) }));
        const done = new Set((await tx.interestCredit.findMany({ where: { accountId, account: { userId } }, select: { year: true } })).map((c) => c.year));
        const { id: categoryId } = await tx.category.findUniqueOrThrow({ where: { nameKey: 'interest' } });
        let created = 0;
        // ponytail: une année calculée à 0 (ou sans taux) est recalculée à chaque passage ; marquer ces années si le job devient lent.
        for (let year = first.date.getUTCFullYear(); year < Number(today.slice(0, 4)); year++) {
          if (done.has(year)) continue;
          const rows = await tx.$queryRaw<{ date: Date; balance: bigint }[]>(dailyBalancesSql(userId, accountId, `${year}-12-31`));
          const result = yearlyInterest(rows.map((r) => ({ date: toLocalDate(r.date), balanceCents: Number(r.balance) })), rates, year);
          if (!result.calculable || result.interestCents === 0) continue;
          const { id: transactionId } = await tx.transaction.create({
            data: { userId, accountId, categoryId, name: 'Intérêts', date: toDate(`${year}-12-31`), amountCents: BigInt(result.interestCents), type: 'CREDIT' },
          });
          await tx.interestCredit.create({ data: { accountId, year, transactionId } });
          created++;
        }
        return created;
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }
}
