import { allowance, type AllowanceInput } from './allowance';

// 500 € projetés dans 3 mois (31/01 → 30/04), plancher 200 € ⇒ 300 € à dépenser, 100 €/mois.
const base: AllowanceInput = {
  today: '2026-01-31',
  startDate: '2026-01-31',
  endDate: '2026-04-30',
  floorCents: 20_000,
  period: 'MONTH',
  endBalanceCents: 50_000,
  spending: [],
};

describe('allowance', () => {
  it('(solde projeté en fin − plancher) / nombre de périodes', () => {
    expect(allowance(base)).toEqual({
      floorCents: 20_000,
      period: 'MONTH',
      periods: 3,
      current: { index: 0, from: '2026-02-01', to: '2026-02-28' },
      periodCents: 10_000,
      spentCents: 0,
      remainingCents: 10_000,
      belowFloor: false,
    });
  });

  it('suivi : 50 € dépensés le 1er mois ⇒ 50 € restants, puis 125 €/mois sur les 2 suivants', () => {
    // Le solde réel a baissé de 50 €, donc le solde projeté en fin aussi.
    const spent = { ...base, endBalanceCents: 45_000, spending: [{ date: '2026-02-10', amountCents: 5_000 }] };
    expect(allowance({ ...spent, today: '2026-02-15' })).toMatchObject({ current: { index: 0 }, periodCents: 10_000, spentCents: 5_000, remainingCents: 5_000 });
    // Bornes : le dernier jour d'une période (28/02) lui appartient encore.
    expect(allowance({ ...spent, today: '2026-02-28' })).toMatchObject({ current: { index: 0 }, remainingCents: 5_000 });
    expect(allowance({ ...spent, today: '2026-03-01' })).toMatchObject({
      current: { index: 1, from: '2026-03-01', to: '2026-03-31' },
      periodCents: 12_500,
      spentCents: 0,
      remainingCents: 12_500,
    });
    expect(allowance({ ...spent, today: '2026-04-30' })).toMatchObject({ current: { index: 2, from: '2026-04-01', to: '2026-04-30' }, periodCents: 25_000 });
  });

  it('dépassement : enveloppe restante négative, les périodes suivantes diminuent', () => {
    const over = { ...base, endBalanceCents: 35_000, spending: [{ date: '2026-02-10', amountCents: 15_000 }] };
    expect(allowance({ ...over, today: '2026-02-15' })).toMatchObject({ periodCents: 10_000, remainingCents: -5_000 });
    expect(allowance({ ...over, today: '2026-03-15' })).toMatchObject({ periodCents: 7_500, remainingCents: 7_500 });
  });

  it('plancher supérieur au solde projeté ⇒ enveloppe 0 et alerte', () => {
    expect(allowance({ ...base, floorCents: 60_000 })).toMatchObject({ periodCents: 0, remainingCents: 0, belowFloor: true });
    expect(allowance({ ...base, floorCents: 50_000 })).toMatchObject({ periodCents: 0, belowFloor: false });
    // Plancher négatif : découvert accepté.
    expect(allowance({ ...base, floorCents: -10_000 })).toMatchObject({ periodCents: 20_000 });
  });

  it('semaine : périodes de 7 jours depuis la date de début', () => {
    const week = { ...base, today: '2026-03-31', startDate: '2026-03-31', endDate: '2026-04-28', period: 'WEEK' as const, endBalanceCents: 60_000 };
    expect(allowance(week)).toMatchObject({ periods: 4, current: { index: 0, from: '2026-04-01', to: '2026-04-07' }, periodCents: 10_000 });
    expect(allowance({ ...week, today: '2026-04-08' })).toMatchObject({ current: { index: 1, from: '2026-04-08', to: '2026-04-14' } });
    // Même période en mois : une seule période, partielle, qui reçoit tout.
    expect(allowance({ ...week, period: 'MONTH' })).toMatchObject({ periods: 1, current: { index: 0, to: '2026-04-28' }, periodCents: 40_000 });
  });

  it('dernière période partielle : proratisée en jours', () => {
    // ]31/01, 28/02] complète, puis ]28/02, 15/03] : 15 jours sur 31 ⇒ 460 € répartis 31/46 et 15/46.
    const partial = { ...base, endDate: '2026-03-15', endBalanceCents: 66_000 };
    expect(allowance(partial)).toMatchObject({ periods: 2, periodCents: 31_000 });
    expect(allowance({ ...partial, today: '2026-03-01' })).toMatchObject({ current: { index: 1, from: '2026-03-01', to: '2026-03-15' }, periodCents: 46_000 });
    // Arrondi au centime inférieur : la somme des enveloppes ne dépasse jamais le disponible.
    expect(allowance({ ...base, endBalanceCents: 20_100 })).toMatchObject({ periodCents: 33 });
  });

  it('période en cours partiellement écoulée ; simulation pas encore commencée ; ancrage au 31', () => {
    // Le 15/02, seules les dépenses du 01/02 au 28/02 comptent, y compris celles déjà saisies pour la fin du mois.
    const spending = [
      { date: '2026-01-31', amountCents: 1_000 }, // avant la période
      { date: '2026-02-01', amountCents: 2_000 },
      { date: '2026-02-27', amountCents: 3_000 },
      { date: '2026-03-01', amountCents: 4_000 }, // période suivante
    ];
    expect(allowance({ ...base, today: '2026-02-15', endBalanceCents: 45_000, spending })).toMatchObject({ spentCents: 5_000, periodCents: 10_000, remainingCents: 5_000 });
    expect(allowance({ ...base, today: '2026-01-10' })).toMatchObject({ current: { index: 0, from: '2026-02-01' } });
    // Mois ancré au 31 : 28/02 puis 31/03, sans dérive.
    expect(allowance({ ...base, today: '2026-03-31' }).current).toEqual({ index: 1, from: '2026-03-01', to: '2026-03-31' });
  });

  it('fin ≤ début ou simulation terminée ⇒ RangeError', () => {
    expect(() => allowance({ ...base, endDate: base.startDate })).toThrow(RangeError);
    expect(() => allowance({ ...base, today: '2026-05-01' })).toThrow(RangeError);
  });
});
