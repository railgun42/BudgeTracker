import { addDays, addMonths, SIMULATION_LIMITS, type LocalDate, type ProjectionDto } from '@budgetracker/shared';
import { occurrencesBetween, type RecurrenceRule } from '../../recurrences/engine/occurrences';
import { checkInt } from './loan';

export interface ProjectionInput {
  today: LocalDate;
  months: number;
  /** Solde actuel (transactions datées ≤ today). */
  balanceCents: number;
  /** Transactions déjà saisies, montants signés (CREDIT +, DEBIT −) ; seules celles datées > today comptent. */
  planned: { date: LocalDate; amountCents: number }[];
  /** Récurrences du compte, montant signé ; leurs occurrences > today sont projetées. */
  recurrences: { rule: RecurrenceRule; amountCents: number }[];
  /** Somme des dépenses non récurrentes de la fenêtre (positive). */
  windowSpendCents: number;
  windowMonths: number;
}

/**
 * Un point par mois : solde du point précédent + mouvements datés dans ]précédent, date] − rythme moyen mensuel.
 * Les dates sont calculées depuis today (addMonths(today, k)) : pas de dérive de fin de mois.
 */
export function projection({ today, months, balanceCents, planned, recurrences, windowSpendCents, windowMonths }: ProjectionInput): ProjectionDto {
  checkInt('Durée', months, 1, SIMULATION_LIMITS.maxMonths);
  checkInt('Fenêtre', windowMonths, 1, SIMULATION_LIMITS.maxMonths);
  checkInt('Dépenses', windowSpendCents, 0, Number.MAX_SAFE_INTEGER);

  const averageMonthlySpendCents = Math.round(windowSpendCents / windowMonths);
  const end = addMonths(today, months);
  const events = [
    ...planned.filter((e) => e.date > today),
    ...recurrences.flatMap(({ rule, amountCents }) => occurrencesBetween(rule, addDays(today, 1), end).map((date) => ({ date, amountCents }))),
  ].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  let balance = balanceCents;
  let i = 0;
  const points = [{ date: today, balanceCents: balance }];
  for (let k = 1; k <= months; k++) {
    const date = addMonths(today, k);
    while (i < events.length && events[i].date <= date) balance += events[i++].amountCents;
    balance -= averageMonthlySpendCents;
    points.push({ date, balanceCents: balance });
  }
  return { averageMonthlySpendCents, points };
}
