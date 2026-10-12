import { addDays, addMonths, IntervalUnit, type LocalDate } from '@budgetracker/shared';

export interface RecurrenceRule {
  startDate: LocalDate;
  /** Inclusive. */
  endDate: LocalDate | null;
  interval: number;
  unit: IntervalUnit;
}

// La k-ième occurrence est calculée depuis startDate, jamais depuis la précédente :
// le jour d'ancrage (celui de startDate) ne dérive pas (31/01 → 28/02 → 31/03).
function nth(rule: RecurrenceRule, k: number): LocalDate {
  const n = k * rule.interval;
  switch (rule.unit) {
    case IntervalUnit.DAY:
      return addDays(rule.startDate, n);
    case IntervalUnit.WEEK:
      return addDays(rule.startDate, 7 * n);
    case IntervalUnit.MONTH:
      return addMonths(rule.startDate, n);
    case IntervalUnit.YEAR:
      return addMonths(rule.startDate, 12 * n);
  }
}

/** Occurrences dans [from, to] (bornes incluses), triées. */
export function occurrencesBetween(rule: RecurrenceRule, from: LocalDate, to: LocalDate): LocalDate[] {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new RangeError(`Intervalle entier ≥ 1 attendu : ${rule.interval}`);
  }
  const last = rule.endDate !== null && rule.endDate < to ? rule.endDate : to;
  const out: LocalDate[] = [];
  // ponytail: parcours depuis k = 0, O(occurrences depuis startDate) ; sauter à k ≈ (from − start)/pas si des règles quotidiennes très anciennes pèsent.
  for (let k = 0; ; k++) {
    const d = nth(rule, k);
    if (d > last) return out;
    if (d >= from) out.push(d);
  }
}
