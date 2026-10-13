import { SIMULATION_LIMITS, type SavingsGoalDto } from '@budgetracker/shared';
import { checkInt } from './loan';

/** « X € dans N mois » : effort mensuel (arrondi au centime supérieur) et progression en points de base. */
export function savingsGoal({ targetCents, months, savedCents }: { targetCents: number; months: number; savedCents: number }): SavingsGoalDto {
  checkInt('Objectif', targetCents, 1, SIMULATION_LIMITS.maxAmountCents);
  checkInt('Durée', months, 1, SIMULATION_LIMITS.maxMonths);
  checkInt('Épargne', savedCents, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

  const remainingCents = Math.max(0, targetCents - savedCents);
  return {
    savedCents,
    remainingCents,
    monthlyCents: Math.ceil(remainingCents / months),
    // Solde négatif ⇒ 0 ; dépassé ⇒ plafonné à 100 %.
    progressBp: Math.min(10_000, Math.max(0, Math.floor((savedCents * 10_000) / targetCents))),
  };
}
