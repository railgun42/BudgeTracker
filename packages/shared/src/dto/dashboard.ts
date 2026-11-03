import type { TransactionType } from '../enums';
import type { LocalDate } from '../local-date';

// Tableau de bord (SPEC §7). Bornes validées par l'API.
export const DASHBOARD_LIMITS = { maxAccountIds: 50, maxSeriesDays: 400, maxUpcomingDays: 31 } as const;

/** Période unique du tableau de bord ; THIS_MONTH par défaut. */
export const DASHBOARD_PERIODS = ['THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS', 'LAST_3_MONTHS', 'LAST_12_MONTHS'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Blocs masquables (les alertes ne le sont pas). */
export const DASHBOARD_BLOCKS = ['KEY_FIGURES', 'PERIOD_SUMMARY', 'BALANCE_CURVE', 'LATEST_TRANSACTIONS', 'CATEGORY_DONUT'] as const;
export type DashboardBlock = (typeof DASHBOARD_BLOCKS)[number];

// PUT /dashboard/preferences : remplacement complet. `version` périmée ⇒ 409 (0 tant que rien n'est enregistré).
// Comptes : au plus DASHBOARD_LIMITS.maxAccountIds, de l'utilisateur et non supprimés (sinon 404).
export interface UpdateDashboardPreferencesInput {
  version: number;
  period: DashboardPeriod;
  /** Comptes des chiffres clés ; `null` = tous les comptes suivis. */
  accountIds: string[] | null;
  /** Comptes tracés sur la courbe, en plus du total si `curveTotal`. */
  curveAccountIds: string[];
  curveTotal: boolean;
  hiddenBlocks: DashboardBlock[];
}

// GET /dashboard/preferences : valeurs par défaut (version 0) si rien n'est enregistré ; les comptes supprimés
// depuis (ou effacés par la réinitialisation) sont retirés à la lecture.
export type DashboardPreferencesDto = UpdateDashboardPreferencesInput;

// GET /dashboard/balance-series?from&to[&accountIds=id1,id2] (défaut : tous les comptes). Solde de fin de journée,
// même règle que GET /accounts/:id/balance (solde de départ, countInBalance, virements). from ≤ to, au plus
// DASHBOARD_LIMITS.maxSeriesDays jours (sinon 422) ; compte étranger ⇒ 404 ; comptes NOT_TRACKED omis.
export interface BalanceSeriesDto {
  /** Chaque jour de from à to inclus. */
  dates: LocalDate[];
  /** Un solde par jour de `dates`, dans l'ordre de la liste des comptes. */
  accounts: { accountId: string; balancesCents: number[] }[];
  /** Somme des comptes renvoyés, jour par jour. */
  totalCents: number[];
}

// GET /dashboard/upcoming[?days=7&today=YYYY-MM-DD] : occurrences des récurrences sur ]today, today + days],
// pas encore générées ; triées par date. days de 1 à DASHBOARD_LIMITS.maxUpcomingDays.
export interface UpcomingOccurrenceDto {
  recurrenceId: string;
  accountId: string;
  date: LocalDate;
  name: string;
  amountCents: number;
  type: TransactionType;
  categoryId: string | null;
}
