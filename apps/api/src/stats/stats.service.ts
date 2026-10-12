import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoryStatDto, MonthlyStatDto, StatsQuery, StatTotals, TagStatDto } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Row = { key: string; income: bigint; expense: bigint };

// Agrégat SQL paramétré (SPEC §6) : jamais de chargement des lignes. Périmètre commun (SPEC §3.4, PLAN E24) :
// - transactions et comptes non supprimés, de l'utilisateur ;
// - jambes de virement exclues ; le virement vers un portefeuille, sans transferId, reste une dépense « Espèces » ;
// - « Solde de départ » exclu : ni revenu ni dépense (NOT IN : sûr même si la catégorie manque) ;
// - compte NOT_TRACKED : dépenses seulement (un compte peut l'être devenu après avoir reçu des CREDIT).
// SUM(bigint) est un numeric : recasté en bigint, puis number (centimes ≤ 9·10¹⁵).
export const statsSql = (userId: string, { from, to, accountId }: StatsQuery, key: Prisma.Sql, join: Prisma.Sql, orderBy: Prisma.Sql) => Prisma.sql`
  SELECT ${key} AS "key",
    COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'CREDIT'), 0)::bigint AS "income",
    COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'DEBIT'), 0)::bigint AS "expense"
  FROM "Transaction" t
  JOIN "Account" a ON a."id" = t."accountId"
  ${join}
  WHERE t."userId" = ${userId}::uuid AND a."userId" = ${userId}::uuid
    AND t."deletedAt" IS NULL AND a."deletedAt" IS NULL
    AND t."transferId" IS NULL
    AND t."categoryId" NOT IN (SELECT "id" FROM "Category" WHERE "nameKey" = 'opening_balance')
    AND (t."type" = 'DEBIT' OR a."trackingType" <> 'NOT_TRACKED')
    ${from ? Prisma.sql`AND t."date" >= ${from}::date` : Prisma.empty}
    ${to ? Prisma.sql`AND t."date" <= ${to}::date` : Prisma.empty}
    ${accountId ? Prisma.sql`AND t."accountId" = ${accountId}::uuid` : Prisma.empty}
  GROUP BY 1
  ORDER BY ${orderBy}`;

const byAmount = Prisma.sql`"expense" DESC, "income" DESC, 1`;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  private async aggregate(userId: string, query: StatsQuery, key: Prisma.Sql, join: Prisma.Sql, orderBy: Prisma.Sql) {
    // Compte d'un autre utilisateur ou supprimé ⇒ 404, comme /transactions.
    if (query.accountId && !(await this.prisma.account.count({ where: { id: query.accountId, userId, deletedAt: null } })))
      throw new NotFoundException('Compte introuvable');
    const rows = await this.prisma.$queryRaw<Row[]>(statsSql(userId, query, key, join, orderBy));
    return rows.map(({ key, income, expense }) => ({ key, totals: { incomeCents: Number(income), expenseCents: Number(expense) } satisfies StatTotals }));
  }

  async byCategory(userId: string, query: StatsQuery): Promise<CategoryStatDto[]> {
    const rows = await this.aggregate(userId, query, Prisma.sql`t."categoryId"`, Prisma.empty, byAmount);
    return rows.map(({ key, totals }) => ({ categoryId: key, ...totals }));
  }

  async byTag(userId: string, query: StatsQuery): Promise<TagStatDto[]> {
    const join = Prisma.sql`JOIN "TransactionTag" tt ON tt."transactionId" = t."id"`;
    const rows = await this.aggregate(userId, query, Prisma.sql`tt."tagId"`, join, byAmount);
    return rows.map(({ key, totals }) => ({ tagId: key, ...totals }));
  }

  async monthly(userId: string, query: StatsQuery): Promise<MonthlyStatDto[]> {
    const rows = await this.aggregate(userId, query, Prisma.sql`to_char(t."date", 'YYYY-MM')`, Prisma.empty, Prisma.sql`1`);
    return rows.map(({ key, totals }) => ({ month: key, ...totals }));
  }
}
