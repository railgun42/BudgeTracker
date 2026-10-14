import { IntervalUnit, TransactionType } from '@budgetracker/shared';
import { cashflow, type CashflowInput, type CashflowLine } from './cashflow';

const { CREDIT, DEBIT } = TransactionType;
// Loyer de 700 € le 5, salaire de 2 000 € le 28 ; aujourd'hui 31/03, solde 1 000 €.
const rent: CashflowLine = {
  source: 'RECURRENCE',
  id: 'rent',
  name: 'Loyer',
  type: DEBIT,
  amountCents: 70_000,
  included: true,
  rule: { startDate: '2026-01-05', endDate: null, interval: 1, unit: IntervalUnit.MONTH },
};
const salary: CashflowLine = {
  source: 'RECURRENCE',
  id: 'salary',
  name: 'Salaire',
  type: CREDIT,
  amountCents: 200_000,
  included: true,
  rule: { startDate: '2026-01-28', endDate: null, interval: 1, unit: IntervalUnit.MONTH },
};
const base: CashflowInput = { today: '2026-03-31', startDate: '2026-03-31', endDate: '2026-05-31', balanceCents: 100_000, lines: [rent, salary] };

describe('cashflow', () => {
  it('solde au jour X : solde actuel + occurrences de ]début, fin], détail par récurrence et courbe', () => {
    expect(cashflow(base)).toEqual({
      startDate: '2026-03-31',
      endDate: '2026-05-31',
      startBalanceCents: 100_000,
      endBalanceCents: 100_000 - 2 * 70_000 + 2 * 200_000,
      creditCents: 400_000,
      debitCents: 140_000,
      items: [
        { source: 'RECURRENCE', id: 'rent', name: 'Loyer', type: DEBIT, amountCents: 70_000, included: true, occurrences: 2, totalCents: 140_000 },
        { source: 'RECURRENCE', id: 'salary', name: 'Salaire', type: CREDIT, amountCents: 200_000, included: true, occurrences: 2, totalCents: 400_000 },
      ],
      points: [
        { date: '2026-03-31', balanceCents: 100_000 },
        { date: '2026-04-05', balanceCents: 30_000 },
        { date: '2026-04-28', balanceCents: 230_000 },
        { date: '2026-05-05', balanceCents: 160_000 },
        { date: '2026-05-28', balanceCents: 360_000 },
        { date: '2026-05-31', balanceCents: 360_000 },
      ],
    });
  });

  it('récurrence décochée : détaillée (ce qu’elle aurait coûté) mais hors solde et hors totaux', () => {
    const result = cashflow({ ...base, lines: [{ ...rent, included: false }, salary] });
    expect(result.endBalanceCents).toBe(100_000 + 2 * 200_000);
    expect(result.debitCents).toBe(0);
    expect(result.items[0]).toEqual({ source: 'RECURRENCE', id: 'rent', name: 'Loyer', type: DEBIT, amountCents: 70_000, included: false, occurrences: 2, totalCents: 140_000 });
    expect(result.points.map((p) => p.date)).toEqual(['2026-03-31', '2026-04-28', '2026-05-28', '2026-05-31']);
  });

  it('ponctuelles et récurrences supplémentaires : comptées seulement quand elles figurent dans la simulation', () => {
    const extras: CashflowLine[] = [
      { source: 'EXTRA_RECURRENCE', id: null, name: 'Sport', type: DEBIT, amountCents: 3_000, included: true, rule: { startDate: '2026-04-01', endDate: '2026-04-30', interval: 1, unit: IntervalUnit.WEEK } },
      { source: 'ONE_OFF', id: null, name: 'Vacances', type: DEBIT, amountCents: 120_000, included: true, date: '2026-05-15' },
      { source: 'ONE_OFF', id: null, name: 'Après la fin', type: DEBIT, amountCents: 1, included: true, date: '2026-06-01' },
      { source: 'ONE_OFF', id: null, name: 'Passée', type: CREDIT, amountCents: 1, included: true, date: '2026-03-31' }, // déjà dans le solde actuel
    ];
    const without = cashflow(base);
    const result = cashflow({ ...base, lines: [...base.lines, ...extras] });
    // Sport : 01, 08, 15, 22, 29/04 (endDate inclusive).
    expect(result.endBalanceCents).toBe(without.endBalanceCents - 5 * 3_000 - 120_000);
    expect(result.items.slice(2).map((i) => [i.name, i.occurrences, i.totalCents])).toEqual([
      ['Sport', 5, 15_000],
      ['Vacances', 1, 120_000],
      ['Après la fin', 0, 0],
      ['Passée', 0, 0],
    ]);
    expect(cashflow(base)).toEqual(without); // l'entrée n'est pas modifiée par l'appel précédent
  });

  it('date de début dans le futur : les mouvements entre aujourd’hui et le début forment le solde de départ', () => {
    const planned: CashflowLine = { source: 'PLANNED', id: 'dentist', name: 'Dentiste', type: DEBIT, amountCents: 5_000, included: true, date: '2026-04-20' };
    const result = cashflow({ ...base, startDate: '2026-04-30', lines: [...base.lines, planned] });
    expect(result.startBalanceCents).toBe(100_000 - 70_000 + 200_000 - 5_000);
    expect(result.endBalanceCents).toBe(cashflow({ ...base, lines: [...base.lines, planned] }).endBalanceCents);
    // Une occurrence de chaque récurrence dans ]30/04, 31/05] ; la transaction du 20/04 n'est pas dans le détail.
    expect(result.items.map((i) => [i.id, i.occurrences])).toEqual([
      ['rent', 1],
      ['salary', 1],
    ]);
    expect(result.points[0]).toEqual({ date: '2026-04-30', balanceCents: result.startBalanceCents });
  });

  it('mouvements du même jour : un seul point ; période d’un jour', () => {
    const sameDay: CashflowLine[] = [
      { source: 'ONE_OFF', id: null, name: 'A', type: DEBIT, amountCents: 1_000, included: true, date: '2026-04-01' },
      { source: 'ONE_OFF', id: null, name: 'B', type: CREDIT, amountCents: 300, included: true, date: '2026-04-01' },
    ];
    expect(cashflow({ ...base, endDate: '2026-04-01', lines: sameDay }).points).toEqual([
      { date: '2026-03-31', balanceCents: 100_000 },
      { date: '2026-04-01', balanceCents: 99_300 },
    ]);
    expect(cashflow({ ...base, endDate: '2026-03-31' }).points).toEqual([{ date: '2026-03-31', balanceCents: 100_000 }]);
  });

  it('fin avant le début, début dans le passé, montant invalide ⇒ RangeError', () => {
    expect(() => cashflow({ ...base, endDate: '2026-03-30' })).toThrow(RangeError);
    expect(() => cashflow({ ...base, startDate: '2026-03-30' })).toThrow(RangeError);
    expect(() => cashflow({ ...base, lines: [{ ...rent, amountCents: 0 }] })).toThrow(RangeError);
  });
});
