import { SIMULATION_LIMITS, type LoanQuery, type LoanResultDto } from '@budgetracker/shared';

export function checkInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} invalide : ${value}`);
}

/**
 * Prêt à mensualités constantes : M = C × r / (1 − (1 + r)^−n), r = taux annuel / 12, arrondie au centime.
 * Le tableau d'amortissement est déroulé en centimes (intérêt du mois arrondi) ; la dernière mensualité
 * solde le capital restant, donc totalInterestCents = totalPaidCents − principalCents exactement.
 */
export function loan({ principalCents, annualRateBp, months }: LoanQuery): LoanResultDto {
  const { maxAmountCents, maxRateBp, maxMonths } = SIMULATION_LIMITS;
  checkInt('Capital', principalCents, 1, maxAmountCents);
  checkInt('Taux', annualRateBp, 0, maxRateBp);
  checkInt('Durée', months, 1, maxMonths);

  const r = annualRateBp / 120_000;
  const monthly = Math.round(r === 0 ? principalCents / months : (principalCents * r) / (1 - (1 + r) ** -months));
  let balance = principalCents;
  let totalInterest = 0;
  let payment = 0;
  for (let m = 1; m <= months; m++) {
    const interest = Math.round((balance * annualRateBp) / 120_000);
    totalInterest += interest;
    balance += interest;
    payment = m === months ? balance : Math.min(monthly, balance);
    balance -= payment;
  }
  return {
    monthlyPaymentCents: monthly,
    lastPaymentCents: payment,
    totalPaidCents: principalCents + totalInterest,
    totalInterestCents: totalInterest,
  };
}
