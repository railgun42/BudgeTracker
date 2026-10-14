import { addDays, TransactionType, type CashflowDto, type CashflowItemDto, type LocalDate, type ProjectionPointDto } from '@budgetracker/shared';
import { occurrencesBetween, type RecurrenceRule } from '../../recurrences/engine/occurrences';
import { checkInt } from './loan';

/** Une ligne de la simulation : récurrente (`rule`) ou datée (`date`). */
export type CashflowLine = Omit<CashflowItemDto, 'occurrences' | 'totalCents'> & ({ rule: RecurrenceRule } | { date: LocalDate });

export interface CashflowInput {
  today: LocalDate;
  startDate: LocalDate;
  endDate: LocalDate;
  /** Solde actuel des comptes (transactions datées ≤ today). */
  balanceCents: number;
  lines: CashflowLine[];
}

/**
 * Simulation de trésorerie (SPEC §6.2). Les mouvements de ]today, startDate] forment le solde de départ,
 * ceux de ]startDate, endDate] le détail de la période. Une ligne non incluse est détaillée mais ne touche aucun solde.
 */
export function cashflow({ today, startDate, endDate, balanceCents, lines }: CashflowInput): CashflowDto {
  if (startDate < today || endDate < startDate) throw new RangeError(`Période invalide : ${startDate} → ${endDate}`);

  let startBalanceCents = balanceCents;
  const events: { date: LocalDate; amountCents: number }[] = [];
  const items = lines.map(({ source, id, name, type, amountCents, included, ...when }): CashflowItemDto => {
    checkInt('Montant', amountCents, 1, Number.MAX_SAFE_INTEGER);
    const signed = type === TransactionType.CREDIT ? amountCents : -amountCents;
    const dates = 'rule' in when ? occurrencesBetween(when.rule, addDays(today, 1), endDate) : when.date > today && when.date <= endDate ? [when.date] : [];
    const inPeriod = dates.filter((date) => date > startDate);
    if (included) {
      startBalanceCents += signed * (dates.length - inPeriod.length);
      events.push(...inPeriod.map((date) => ({ date, amountCents: signed })));
    }
    return { source, id, name, type, amountCents, included, occurrences: inPeriod.length, totalCents: amountCents * inPeriod.length };
  });
  events.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  let balance = startBalanceCents;
  const points: ProjectionPointDto[] = [{ date: startDate, balanceCents: balance }];
  for (const { date, amountCents } of events) {
    balance += amountCents;
    if (points[points.length - 1].date === date) points[points.length - 1].balanceCents = balance;
    else points.push({ date, balanceCents: balance });
  }
  if (points[points.length - 1].date !== endDate) points.push({ date: endDate, balanceCents: balance });

  const total = (t: TransactionType) => items.filter((i) => i.included && i.type === t).reduce((sum, i) => sum + i.totalCents, 0);
  return {
    startDate,
    endDate,
    startBalanceCents,
    endBalanceCents: balance,
    creditCents: total(TransactionType.CREDIT),
    debitCents: total(TransactionType.DEBIT),
    // Une transaction déjà saisie mais antérieure à la période n'est que dans le solde de départ.
    items: items.filter((i) => i.source !== 'PLANNED' || i.occurrences > 0),
    points,
  };
}
