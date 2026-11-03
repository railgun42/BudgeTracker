import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  addDays,
  BalanceSeriesDto,
  DASHBOARD_LIMITS,
  DASHBOARD_PERIODS,
  DashboardPreferencesDto,
  LocalDate,
  TrackingType,
  UpcomingOccurrenceDto,
  UpdateDashboardPreferencesInput,
} from '@budgetracker/shared';
import { AccountsService, toAccountDto } from '../accounts/accounts.service';
import { balanceDaysSql } from '../balance/balance.service';
import { PrismaService } from '../prisma/prisma.service';
import { occurrencesBetween } from '../recurrences/engine/occurrences';
import { RecurrencesService, toRecurrenceDto } from '../recurrences/recurrences.service';
import { toLocalDate } from '../transactions/transactions.service';
import { balanceSeries } from './engine/balance-series';

type Prefs = Omit<DashboardPreferencesDto, 'version'>;
const DEFAULTS: Prefs = { period: 'THIS_MONTH', accountIds: null, curveAccountIds: [], curveTotal: true, hiddenBlocks: [] };

// Tableau de bord (SPEC §7, PLAN E42a). Toute requête filtre userId ; comptes supprimés exclus (AccountsService.list).
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly recurrences: RecurrencesService,
  ) {}

  async getPreferences(userId: string): Promise<DashboardPreferencesDto> {
    const row = await this.prisma.dashboardPreference.findUnique({ where: { userId } });
    if (!row) return { ...DEFAULTS, version: 0 };
    const prefs = row.prefs as unknown as Prefs; // validé par le DTO à l'écriture
    const live = await this.liveIds(userId);
    const keep = (ids: string[]) => ids.filter((id) => live.has(id));
    // Période retirée de la liste depuis l'enregistrement : valeur par défaut.
    const period = DASHBOARD_PERIODS.includes(prefs.period) ? prefs.period : DEFAULTS.period;
    return { ...prefs, period, accountIds: prefs.accountIds && keep(prefs.accountIds), curveAccountIds: keep(prefs.curveAccountIds), version: row.version };
  }

  // Version 0 : première écriture (une ligne déjà là ⇒ 409, comme une version périmée).
  async putPreferences(userId: string, { version, period, accountIds, curveAccountIds, curveTotal, hiddenBlocks }: UpdateDashboardPreferencesInput): Promise<DashboardPreferencesDto> {
    const live = await this.liveIds(userId);
    if (![...(accountIds ?? []), ...curveAccountIds].every((id) => live.has(id))) throw new NotFoundException();
    const prefs = { period, accountIds, curveAccountIds, curveTotal, hiddenBlocks };
    const { count } =
      version === 0
        ? await this.prisma.dashboardPreference.createMany({ data: [{ userId, prefs }], skipDuplicates: true })
        : await this.prisma.dashboardPreference.updateMany({ where: { userId, version }, data: { prefs, version: { increment: 1 } } });
    if (count === 0) throw new ConflictException('Les préférences ont été modifiées entre-temps');
    return this.getPreferences(userId);
  }

  // Une requête agrégée par compte (index (accountId, date)), jamais les transactions une à une.
  async balanceSeries(userId: string, from: LocalDate, to: LocalDate, accountIds?: string[]): Promise<BalanceSeriesDto> {
    if (from > to) throw new UnprocessableEntityException('from postérieure à to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > DASHBOARD_LIMITS.maxSeriesDays) throw new UnprocessableEntityException('Fenêtre trop longue');
    const all = (await this.accounts.list(userId)).map(toAccountDto);
    const wanted = accountIds && new Set(accountIds);
    const chosen = wanted ? all.filter((a) => wanted.has(a.id)) : all;
    if (wanted && chosen.length !== wanted.size) throw new NotFoundException();
    const series = await Promise.all(
      chosen.map(async ({ id, trackingType, openingDate }) => {
        const rows =
          trackingType === TrackingType.NOT_TRACKED
            ? []
            : await this.prisma.$queryRaw<{ date: LocalDate | null; counted: boolean; opening: boolean; cents: bigint }[]>(balanceDaysSql(userId, id, from, to));
        return { accountId: id, trackingType, openingDate, rows: rows.map((r) => ({ ...r, cents: Number(r.cents) })) };
      }),
    );
    return balanceSeries(series, from, to);
  }

  // Échéances de ]today, today + days] pas encore générées (au-delà de lastGeneration).
  async upcoming(userId: string, days: number, today: LocalDate): Promise<UpcomingOccurrenceDto[]> {
    const end = addDays(today, days);
    return (await this.recurrences.list(userId))
      .flatMap((r) => {
        const { startDate, endDate, interval, unit, template } = toRecurrenceDto(r);
        const last = r.lastGeneration && toLocalDate(r.lastGeneration);
        const from = addDays(last && last > today ? last : today, 1);
        return occurrencesBetween({ startDate, endDate, interval, unit }, from, end).map((date) => ({
          recurrenceId: r.id,
          accountId: r.accountId,
          date,
          name: template.name,
          amountCents: template.amountCents,
          type: template.type,
          categoryId: template.categoryId,
        }));
      })
      .sort((x, y) => x.date.localeCompare(y.date));
  }

  private async liveIds(userId: string): Promise<Set<string>> {
    return new Set((await this.accounts.list(userId)).map((a) => a.id));
  }
}
