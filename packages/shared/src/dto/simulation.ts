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
