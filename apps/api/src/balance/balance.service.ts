import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountBalanceDto, LocalDate, TrackingType } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OPENING = Prisma.sql`(SELECT "id" FROM "Category" WHERE "nameKey" = 'opening_balance')`;

// Solde de départ (SPEC §3.3) : ce qui le précède y est déjà compris, donc hors solde ; le même jour,
// la transaction compte sauf choix contraire (`countInBalance`). Le plus récent fait foi. Évalué à la
// lecture : modifier la date du solde de départ, le supprimer ou le restaurer suffit à tout recalculer.
// À utiliser avec `FROM "Transaction" t, "opening" o`.
export const openingCte = (userId: string, accountId: string) => Prisma.sql`
  "opening" AS (
    SELECT MAX("date") AS "date" FROM "Transaction"
    WHERE "accountId" = ${accountId}::uuid AND "userId" = ${userId}::uuid AND "deletedAt" IS NULL AND "categoryId" = ${OPENING})`;
export const countedSql = Prisma.sql`(o."date" IS NULL OR t."date" > o."date"
  OR (t."date" = o."date" AND (t."countInBalance" IS NOT FALSE OR t."categoryId" = ${OPENING})))`;

// Un seul SUM SQL sur l'index (accountId, date), jamais de chargement des lignes (SPEC §3.3).
// SUM(bigint) est un numeric en Postgres : recasté en bigint, puis number (centimes ≤ 9·10¹⁵).
export const balanceSql = (userId: string, accountId: string, today: LocalDate) => Prisma.sql`
  WITH ${openingCte(userId, accountId)}
  SELECT
    COALESCE(SUM(CASE WHEN t."type" = 'CREDIT' THEN t."amountCents" ELSE -t."amountCents" END) FILTER (WHERE t."date" <= ${today}::date), 0)::bigint AS "current",
    COALESCE(SUM(CASE WHEN t."type" = 'CREDIT' THEN t."amountCents" ELSE -t."amountCents" END), 0)::bigint AS "forecast"
  FROM "Transaction" t, "opening" o
  WHERE t."accountId" = ${accountId}::uuid AND t."userId" = ${userId}::uuid AND t."deletedAt" IS NULL AND ${countedSql}`;

// Série de soldes (tableau de bord) : sommes par jour de [from, to] (`date` NULL = avant `from`), séparées selon que la
// règle du solde ci-dessus les compte (`counted`) ou non (déjà comprises dans le solde de départ). `opening` : le solde de
// départ lui-même. Les lignes non comptées sont rendues jusqu'au solde de départ, même après `to` : balanceSeries s'en sert
// pour reconstituer, à rebours, le solde d'avant le solde de départ.
const COUNTED = Prisma.sql`COALESCE(${countedSql}, false)`;
export const balanceDaysSql = (userId: string, accountId: string, from: LocalDate, to: LocalDate) => Prisma.sql`
  WITH ${openingCte(userId, accountId)}
  SELECT
    CASE WHEN t."date" < ${from}::date THEN NULL ELSE to_char(t."date", 'YYYY-MM-DD') END AS "date",
    ${COUNTED} AS "counted",
    COALESCE(t."categoryId" = ${OPENING}, false) AS "opening",
    SUM(CASE WHEN t."type" = 'CREDIT' THEN t."amountCents" ELSE -t."amountCents" END)::bigint AS "cents"
  FROM "Transaction" t, "opening" o
  WHERE t."accountId" = ${accountId}::uuid AND t."userId" = ${userId}::uuid AND t."deletedAt" IS NULL
    AND (t."date" <= ${to}::date OR NOT ${COUNTED} OR t."categoryId" = ${OPENING})
  GROUP BY 1, 2, 3`;

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, accountId: string, today: LocalDate): Promise<AccountBalanceDto> {
    // Compte d'un autre utilisateur ou supprimé ⇒ 404 (ses transactions sont alors masquées).
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId, deletedAt: null } });
    if (!account) throw new NotFoundException();
    if (account.trackingType === TrackingType.NOT_TRACKED) return { currentCents: null, forecastCents: null };
    const [{ current, forecast }] = await this.prisma.$queryRaw<{ current: bigint; forecast: bigint }[]>(balanceSql(userId, accountId, today));
    return { currentCents: Number(current), forecastCents: Number(forecast) };
  }
}
