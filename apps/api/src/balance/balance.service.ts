import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountBalanceDto, LocalDate, TrackingType } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Un seul SUM SQL sur l'index (accountId, date), jamais de chargement des lignes (SPEC §3.3).
// SUM(bigint) est un numeric en Postgres : recasté en bigint, puis number (centimes ≤ 9·10¹⁵).
export const balanceSql = (userId: string, accountId: string, today: LocalDate) => Prisma.sql`
  SELECT
    COALESCE(SUM(CASE WHEN "type" = 'CREDIT' THEN "amountCents" ELSE -"amountCents" END) FILTER (WHERE "date" <= ${today}::date), 0)::bigint AS "current",
    COALESCE(SUM(CASE WHEN "type" = 'CREDIT' THEN "amountCents" ELSE -"amountCents" END), 0)::bigint AS "forecast"
  FROM "Transaction"
  WHERE "accountId" = ${accountId}::uuid AND "userId" = ${userId}::uuid AND "deletedAt" IS NULL`;

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
