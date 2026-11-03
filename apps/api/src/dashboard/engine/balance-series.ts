import { addDays, TrackingType, type BalanceSeriesDto, type LocalDate } from '@budgetracker/shared';

/** Sommes signées (CREDIT +, DEBIT −) d'un compte pour un jour, agrégées en SQL. */
export interface DayRow {
  /** `null` : avant le début de la fenêtre ; peut aussi dépasser sa fin (lignes non comptées jusqu'au solde de départ). */
  date: LocalDate | null;
  /** Comptée dans le solde (règle du solde de départ, SPEC §3.3) ; sinon déjà comprise dans le solde de départ. */
  counted: boolean;
  /** Le solde de départ lui-même (un plus ancien, remplacé, n'est pas compté). */
  opening: boolean;
  cents: number;
}

export interface SeriesAccount {
  accountId: string;
  trackingType: TrackingType;
  /** Date du solde de départ le plus récent. */
  openingDate: LocalDate | null;
  rows: DayRow[];
}

/**
 * Solde de fin de journée de chaque compte suivi sur [from, to], plus le total. NOT_TRACKED : omis (pas de solde).
 * À partir du solde de départ : somme des lignes comptées, comme le solde. Avant : solde de départ moins les mouvements
 * non comptés postérieurs au jour (ils sont compris dans le solde saisi, on les défait à rebours), si bien que
 * l'historique recopié de la banque donne une courbe continue jusqu'au solde de départ.
 */
export function balanceSeries(accounts: SeriesAccount[], from: LocalDate, to: LocalDate): BalanceSeriesDto {
  const dates: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const series = accounts
    .filter((a) => a.trackingType !== TrackingType.NOT_TRACKED)
    .map(({ accountId, openingDate, rows }) => {
      const counted = new Map<LocalDate | null, number>();
      const undone = new Map<LocalDate, number>();
      let opening = 0;
      for (const { date, counted: isCounted, opening: isOpening, cents } of rows) {
        if (isCounted) {
          counted.set(date, (counted.get(date) ?? 0) + cents);
          if (isOpening) opening += cents;
        } else if (!isOpening && date !== null) undone.set(date, (undone.get(date) ?? 0) + cents);
      }
      // laterUndone[i] : somme des mouvements non comptés datés après dates[i].
      const laterUndone: number[] = [];
      let run = 0;
      for (const [date, cents] of undone) if (date > to) run += cents;
      for (let i = dates.length - 1; i >= 0; i--) {
        laterUndone[i] = run;
        run += undone.get(dates[i]) ?? 0;
      }
      let balance = counted.get(null) ?? 0;
      const balancesCents = dates.map((d, i) => {
        balance += counted.get(d) ?? 0;
        return openingDate !== null && d < openingDate ? opening - laterUndone[i] : balance;
      });
      return { accountId, balancesCents };
    });
  return { dates, accounts: series, totalCents: dates.map((_, i) => series.reduce((sum, s) => sum + s.balancesCents[i], 0)) };
}
