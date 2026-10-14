import { addDays, addMonths, type AllowanceDto, type AllowancePeriod, type LocalDate } from '@budgetracker/shared';

export interface AllowanceInput {
  today: LocalDate;
  /** Ancre des périodes : date de début de la simulation (figée pour une simulation sauvegardée). */
  startDate: LocalDate;
  endDate: LocalDate;
  floorCents: number;
  period: AllowancePeriod;
  /** Solde projeté au soir de endDate, calculé à partir du solde réel de today. */
  endBalanceCents: number;
  /** Dépenses ponctuelles réelles (montants > 0) ; seules celles de la période en cours sont lues. */
  spending: { date: LocalDate; amountCents: number }[];
}

const days = (from: LocalDate, to: LocalDate) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/**
 * Enveloppe dépensable (SPEC §6.2) : (solde projeté en fin − plancher) / nombre de périodes, recalculée à chaque lecture.
 * Le solde projeté part du solde réel : les dépenses passées l'ont déjà diminué, le reliquat d'une période écoulée se répartit
 * donc sur les suivantes. Les dépenses de la période en cours y sont rajoutées, puis déduites de son enveloppe.
 */
export function allowance({ today, startDate, endDate, floorCents, period, endBalanceCents, spending }: AllowanceInput): AllowanceDto {
  if (endDate <= startDate || today > endDate) throw new RangeError(`Période invalide : ${startDate} → ${endDate} au ${today}`);
  // Bornes depuis l'ancre (pas de dérive au 31 du mois) : la période k est ]bounds[k], bounds[k + 1]].
  const step = (k: number) => (period === 'MONTH' ? addMonths(startDate, k) : addDays(startDate, 7 * k));
  const bounds = [startDate];
  while (bounds[bounds.length - 1] < endDate) bounds.push(step(bounds.length));
  const periods = bounds.length - 1;
  // Dernière période coupée par endDate : poids lastDays / fullDays (1 si complète). Les autres sont complètes.
  const fullDays = days(bounds[periods - 1], bounds[periods]);
  const lastDays = days(bounds[periods - 1], endDate);

  const index = today <= startDate ? 0 : bounds.findIndex((b) => today <= b) - 1;
  const from = addDays(bounds[index], 1);
  const to = index === periods - 1 ? endDate : bounds[index + 1];
  const spentCents = spending.filter((s) => s.date >= from && s.date <= to).reduce((sum, s) => sum + s.amountCents, 0);

  const available = endBalanceCents - floorCents + spentCents;
  // Part de la période en cours : available × 1 / (fullBefore + lastDays / fullDays), en entiers.
  const fullBefore = periods - 1 - index;
  const share = index === periods - 1 ? available : Math.floor((available * fullDays) / (fullBefore * fullDays + lastDays));
  const periodCents = Math.max(0, share);
  return {
    floorCents,
    period,
    periods,
    current: { index, from, to },
    periodCents,
    spentCents,
    remainingCents: periodCents - spentCents,
    belowFloor: endBalanceCents < floorCents,
  };
}
