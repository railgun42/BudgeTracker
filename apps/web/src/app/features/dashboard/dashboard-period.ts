import { addDays, addMonths, DashboardBlock, DashboardPeriod, lastDayOfMonth, LocalDate } from '@budgetracker/shared';

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  THIS_MONTH: 'Ce mois-ci',
  LAST_MONTH: 'Mois dernier',
  LAST_30_DAYS: '30 derniers jours',
  LAST_3_MONTHS: '3 derniers mois',
  LAST_12_MONTHS: '12 derniers mois',
};

/** Blocs masquables déjà présents sur la page (E42c ajoutera la courbe, les dernières transactions et le donut). */
export const BLOCK_LABELS: Partial<Record<DashboardBlock, string>> = {
  KEY_FIGURES: 'Chiffres clés',
  PERIOD_SUMMARY: 'Dépenses et revenus de la période',
};

const endOfMonth = (month: string): LocalDate => `${month}-${lastDayOfMonth(month)}`;

/** Bornes (incluses) de la période, relatives au jour `today` : mois entiers, sauf « 30 derniers jours » qui finit aujourd'hui. */
export function dashboardRange(period: DashboardPeriod, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const first = `${today.slice(0, 7)}-01`;
  switch (period) {
    case 'THIS_MONTH':
      return { from: first, to: endOfMonth(first.slice(0, 7)) };
    case 'LAST_MONTH': {
      const from = addMonths(first, -1);
      return { from, to: endOfMonth(from.slice(0, 7)) };
    }
    case 'LAST_30_DAYS':
      return { from: addDays(today, -29), to: today };
    case 'LAST_3_MONTHS':
      return { from: addMonths(first, -2), to: endOfMonth(first.slice(0, 7)) };
    case 'LAST_12_MONTHS':
      return { from: addMonths(first, -11), to: endOfMonth(first.slice(0, 7)) };
  }
}
