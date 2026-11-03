import { addMonths, DashboardBlock, DashboardPeriod, lastDayOfMonth, LocalDate } from '@budgetracker/shared';

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  THIS_MONTH: 'Mois actuel',
  LAST_3_MONTHS: '3 derniers mois',
  LAST_6_MONTHS: '6 derniers mois',
  LAST_12_MONTHS: '12 derniers mois',
};

/** Blocs masquables (les actions rapides et les alertes ne le sont pas). */
export const BLOCK_LABELS: Record<DashboardBlock, string> = {
  KEY_FIGURES: 'Chiffres clés',
  PERIOD_SUMMARY: 'Dépenses et revenus de la période',
  BALANCE_CURVE: 'Évolution du solde',
  LATEST_TRANSACTIONS: 'Dernières transactions',
  CATEGORY_DONUT: 'Dépenses par catégorie',
};

const endOfMonth = (month: string): LocalDate => `${month}-${lastDayOfMonth(month)}`;

/** Bornes (incluses) de la période, relatives au jour `today` : des mois entiers, le dernier étant le mois courant. */
export function dashboardRange(period: DashboardPeriod, today: LocalDate): { from: LocalDate; to: LocalDate } {
  const first = `${today.slice(0, 7)}-01`;
  switch (period) {
    case 'THIS_MONTH':
      return { from: first, to: endOfMonth(first.slice(0, 7)) };
    case 'LAST_3_MONTHS':
      return { from: addMonths(first, -2), to: endOfMonth(first.slice(0, 7)) };
    case 'LAST_6_MONTHS':
      return { from: addMonths(first, -5), to: endOfMonth(first.slice(0, 7)) };
    case 'LAST_12_MONTHS':
      return { from: addMonths(first, -11), to: endOfMonth(first.slice(0, 7)) };
  }
}
