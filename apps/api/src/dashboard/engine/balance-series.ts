import { addDays, TrackingType, type BalanceSeriesDto, type LocalDate } from '@budgetracker/shared';

/** Sommes signées (CREDIT +, DEBIT −) d'un compte, agrégées en SQL. */
export interface DayRow {
  /** `null` : tout ce qui précède `from`, règle du solde de départ déjà appliquée (même SQL que le solde). */
  date: LocalDate | null;
  /** Comptée si datée du jour du solde de départ : `countInBalance` ≠ false, ou le solde de départ lui-même. */
  sameDay: boolean;
  cents: number;
}

export interface SeriesAccount {
  accountId: string;
  trackingType: TrackingType;
  /** Date du solde de départ le plus récent. */
  openingDate: LocalDate | null;
  rows: DayRow[];
}

// Règle du solde (SPEC §3.3), comme `countedSql` : avant le solde de départ, rien ; le jour même, selon le choix ; après, tout.
const counted = (row: DayRow, opening: LocalDate | null) =>
  row.date === null || opening === null || row.date > opening || (row.date === opening && row.sameDay);

/** Solde de fin de journée de chaque compte suivi sur [from, to], plus le total. NOT_TRACKED : omis (pas de solde). */
export function balanceSeries(accounts: SeriesAccount[], from: LocalDate, to: LocalDate): BalanceSeriesDto {
  const dates: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const series = accounts
    .filter((a) => a.trackingType !== TrackingType.NOT_TRACKED)
    .map(({ accountId, openingDate, rows }) => {
      const byDay = new Map<LocalDate | null, number>();
      for (const row of rows) if (counted(row, openingDate)) byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.cents);
      let balance = byDay.get(null) ?? 0;
      return { accountId, balancesCents: dates.map((d) => (balance += byDay.get(d) ?? 0)) };
    });
  return { dates, accounts: series, totalCents: dates.map((_, i) => series.reduce((sum, s) => sum + s.balancesCents[i], 0)) };
}
