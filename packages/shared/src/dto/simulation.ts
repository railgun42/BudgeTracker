import type { LocalDate } from '../local-date';
import type { IntervalUnit, TransactionType } from '../enums';

// Calculateurs (SPEC §6.4) : purs, aucun accès aux transactions. Taux en points de base (500 = 5 %).
// Bornes communes (validées par l'API) : elles gardent tous les résultats sous 2^53 centimes.
export const SIMULATION_LIMITS = { maxAmountCents: 100_000_000_000, maxMonthlyCents: 1_000_000_000, maxRateBp: 2_000, maxMonths: 600 } as const;

// GET /simulations/loan. Mensualités constantes, intérêts mensuels = taux / 12.
export interface LoanQuery {
  /** Capital emprunté, entier de 1 à 10¹¹ (1 Md €). */
  principalCents: number;
  /** Taux annuel nominal, 0 à 2 000 (20 %). */
  annualRateBp: number;
  /** Durée, 1 à 600 mois. */
  months: number;
}

export interface LoanResultDto {
  /** Mensualité arrondie au centime. */
  monthlyPaymentCents: number;
  /** Dernière mensualité, qui absorbe les écarts d'arrondi. */
  lastPaymentCents: number;
  totalPaidCents: number;
  /** Coût total du crédit = totalPaidCents − principalCents. */
  totalInterestCents: number;
}

// GET /simulations/investment. Capitalisation mensuelle (taux / 12), versements en fin de mois.
export interface InvestmentQuery {
  /** Capital initial, entier de 0 à 10¹¹. */
  initialCents: number;
  /** Versement mensuel, entier de 0 à 10⁹ ; absent ⇒ 0. */
  monthlyContributionCents?: number;
  /** Taux annuel nominal, 0 à 2 000. */
  annualRateBp: number;
  /** Durée, 1 à 600 mois. */
  months: number;
  /** Inflation annuelle, 0 à 2 000 ; absente ⇒ 0. */
  inflationBp?: number;
}

export interface InvestmentResultDto {
  /** Valeur finale nominale. */
  finalCents: number;
  /** Somme du capital initial et des versements. */
  contributedCents: number;
  /** finalCents − contributedCents. */
  interestCents: number;
  /** Valeur finale en euros d'aujourd'hui (déflatée de l'inflation). */
  realFinalCents: number;
}

// GET /simulations/projection (SPEC §6.1). Solde actuel + récurrences futures + transactions futures déjà saisies
// − rythme moyen des dépenses non récurrentes (hors virements) sur les `windowMonths` derniers mois.
export interface ProjectionQuery {
  accountId: string;
  /** Horizon, 1 à 600 mois. */
  months: number;
  /** Fenêtre du rythme moyen, 1 à 600 mois ; absente ⇒ 3 (SPEC §12). */
  windowMonths?: number;
  /** Jour du client ; absent ⇒ jour du serveur (UTC). */
  today?: LocalDate;
}

export interface ProjectionPointDto {
  /** today, puis today + k mois (jour ramené à la fin des mois courts). */
  date: LocalDate;
  balanceCents: number;
}

export interface ProjectionDto {
  /** Dépenses non récurrentes de la fenêtre / windowMonths, arrondi au centime. */
  averageMonthlySpendCents: number;
  /** months + 1 points, le premier étant le solde actuel. */
  points: ProjectionPointDto[];
}

// GET /simulations/savings-goal (SPEC §6.3). « X € dans N mois » ; avec accountId, l'épargne actuelle = son solde actuel.
export interface SavingsGoalQuery {
  /** Objectif, entier de 1 à 10¹¹. */
  targetCents: number;
  /** Échéance, 1 à 600 mois. */
  months: number;
  accountId?: string;
  today?: LocalDate;
}

export interface SavingsGoalDto {
  savedCents: number;
  /** max(0, objectif − épargne actuelle). */
  remainingCents: number;
  /** Effort mensuel arrondi au centime supérieur : months × monthlyCents ≥ remainingCents. */
  monthlyCents: number;
  /** Progression en points de base, 0 à 10 000 (10 000 = objectif atteint). */
  progressBp: number;
}

// POST /simulations/cashflow (SPEC §6.2). Simulation de trésorerie : « combien me restera-t-il au jour X ».
// Rien n'est écrit : les récurrences supplémentaires et les ponctuelles n'existent que dans la simulation.
export const CASHFLOW_LIMITS = { maxAccounts: 20, maxExtraRecurrences: 20, maxOneOffs: 100, maxNameLength: 100 } as const;

/** Récurrence propre à la simulation ; montant 1 à SIMULATION_LIMITS.maxMonthlyCents. */
export interface CashflowRecurrenceInput {
  name: string;
  type: TransactionType;
  amountCents: number;
  /** 1 à 1 000. */
  interval: number;
  unit: IntervalUnit;
  startDate: LocalDate;
  /** Inclusive. */
  endDate?: LocalDate | null;
}

/** Dépense ou revenu ponctuel anticipé, propre à la simulation. */
export interface CashflowOneOffInput {
  name: string;
  type: TransactionType;
  amountCents: number;
  date: LocalDate;
}

export interface CashflowInput {
  /** 1 à 20 comptes avec solde (NOT_TRACKED ⇒ 422) ; leurs soldes sont additionnés. */
  accountIds: string[];
  /** ≥ today ; absente ⇒ today. */
  startDate?: LocalDate;
  /** ≥ startDate, au plus today + 600 mois. */
  endDate: LocalDate;
  /** Récurrences des comptes choisis, décochées pour la simulation (autre id ⇒ 404). */
  excludedRecurrenceIds?: string[];
  extraRecurrences?: CashflowRecurrenceInput[];
  oneOffs?: CashflowOneOffInput[];
  /** Jour du client ; absent ⇒ jour du serveur (UTC). */
  today?: LocalDate;
}

/** RECURRENCE : récurrence enregistrée ; PLANNED : transaction future déjà saisie. */
export type CashflowSource = 'RECURRENCE' | 'EXTRA_RECURRENCE' | 'ONE_OFF' | 'PLANNED';

export interface CashflowItemDto {
  source: CashflowSource;
  /** Id de la récurrence (RECURRENCE) ou de la transaction (PLANNED) ; null pour ce qui est propre à la simulation. */
  id: string | null;
  name: string;
  type: TransactionType;
  /** Montant d'une occurrence, > 0. */
  amountCents: number;
  /** false : récurrence décochée, listée avec ce qu'elle aurait coûté mais hors solde. */
  included: boolean;
  /** Occurrences dans ]startDate, endDate]. */
  occurrences: number;
  /** amountCents × occurrences. */
  totalCents: number;
}

export interface CashflowDto {
  startDate: LocalDate;
  endDate: LocalDate;
  /** Solde projeté au soir de startDate (solde actuel si startDate = today). */
  startBalanceCents: number;
  /** « Ce qui me restera » au soir de endDate. */
  endBalanceCents: number;
  /** Totaux des lignes incluses sur ]startDate, endDate], ≥ 0. */
  creditCents: number;
  debitCents: number;
  /** Récurrences (toutes, décochées comprises), supplémentaires, ponctuelles, puis transactions futures de la période. */
  items: CashflowItemDto[];
  /** startDate, chaque jour portant un mouvement, puis endDate. */
  points: ProjectionPointDto[];
}
