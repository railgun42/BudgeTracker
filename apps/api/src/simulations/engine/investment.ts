import { SIMULATION_LIMITS, type InvestmentQuery, type InvestmentResultDto } from '@budgetracker/shared';
import { checkInt } from './loan';

/**
 * Intérêts composés, capitalisation mensuelle (r = taux annuel / 12), versements en fin de mois :
 * V = I × (1 + r)^n + C × ((1 + r)^n − 1) / r. Valeur réelle = V / (1 + inflation)^(n / 12).
 * Calcul en flottant, arrondi au centime une seule fois à la fin.
 */
export function investment({ initialCents, monthlyContributionCents = 0, annualRateBp, months, inflationBp = 0 }: InvestmentQuery): InvestmentResultDto {
  const { maxAmountCents, maxMonthlyCents, maxRateBp, maxMonths } = SIMULATION_LIMITS;
  checkInt('Capital', initialCents, 0, maxAmountCents);
  checkInt('Versement', monthlyContributionCents, 0, maxMonthlyCents);
  checkInt('Taux', annualRateBp, 0, maxRateBp);
  checkInt('Durée', months, 1, maxMonths);
  checkInt('Inflation', inflationBp, 0, maxRateBp);

  const r = annualRateBp / 120_000;
  const growth = (1 + r) ** months;
  const nominal = initialCents * growth + (r === 0 ? monthlyContributionCents * months : (monthlyContributionCents * (growth - 1)) / r);
  const finalCents = Math.round(nominal);
  const contributedCents = initialCents + monthlyContributionCents * months;
  return {
    finalCents,
    contributedCents,
    interestCents: finalCents - contributedCents,
    realFinalCents: Math.round(nominal / (1 + inflationBp / 10_000) ** (months / 12)),
  };
}
