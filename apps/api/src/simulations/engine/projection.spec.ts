import { IntervalUnit } from '@budgetracker/shared';
import { projection, type ProjectionInput } from './projection';

const BASE: ProjectionInput = { today: '2026-01-31', months: 3, balanceCents: 100_000, planned: [], recurrences: [], windowSpendCents: 0, windowMonths: 3 };
const monthly = (startDate: string, amountCents: number, endDate: string | null = null) => ({
  rule: { startDate, endDate, interval: 1, unit: IntervalUnit.MONTH },
  amountCents,
});

describe('projection', () => {
  it('fenêtre vide, rien de prévu ⇒ rythme 0, solde constant ; dates sans dérive de fin de mois', () => {
    expect(projection(BASE)).toEqual({
      averageMonthlySpendCents: 0,
      points: [
        { date: '2026-01-31', balanceCents: 100_000 },
        { date: '2026-02-28', balanceCents: 100_000 },
        { date: '2026-03-31', balanceCents: 100_000 },
        { date: '2026-04-30', balanceCents: 100_000 },
      ],
    });
  });

  it('rythme moyen = dépenses de la fenêtre / nombre de mois, retiré chaque mois', () => {
    const r = projection({ ...BASE, windowSpendCents: 30_000 });
    expect(r.averageMonthlySpendCents).toBe(10_000);
    expect(r.points.map((p) => p.balanceCents)).toEqual([100_000, 90_000, 80_000, 70_000]);
  });

  it('fenêtre paramétrable, rythme arrondi au centime', () => {
    expect(projection({ ...BASE, windowSpendCents: 30_000, windowMonths: 6 }).averageMonthlySpendCents).toBe(5_000);
    expect(projection({ ...BASE, windowSpendCents: 10_000 }).averageMonthlySpendCents).toBe(3_333);
  });

  it('récurrences : seules les occurrences > today, jusqu’à endDate incluse', () => {
    // Salaire le 15 (l'occurrence du 15/01 est déjà dans le solde) ; loyer le 1er jusqu'au 01/03.
    const r = projection({ ...BASE, recurrences: [monthly('2025-06-15', 200_000), monthly('2025-01-01', -80_000, '2026-03-01')] });
    // 28/02 : +200 000 (15/02) − 80 000 (01/02) ; 31/03 : +200 000 − 80 000 ; 30/04 : +200 000.
    expect(r.points.map((p) => p.balanceCents)).toEqual([100_000, 220_000, 340_000, 540_000]);
  });

  it('transactions déjà saisies : passées et au-delà de l’horizon ignorées, date du point incluse', () => {
    const planned = [
      { date: '2026-01-31', amountCents: -999 }, // ≤ today : déjà dans le solde
      { date: '2026-02-28', amountCents: -5_000 }, // date exacte du 1er point
      { date: '2026-03-01', amountCents: 7_000 },
      { date: '2026-05-01', amountCents: -1 }, // après l'horizon
    ];
    expect(projection({ ...BASE, planned }).points.map((p) => p.balanceCents)).toEqual([100_000, 95_000, 102_000, 102_000]);
  });

  it('tout combiné', () => {
    const r = projection({ ...BASE, windowSpendCents: 90_000, recurrences: [monthly('2026-01-15', -10_000)], planned: [{ date: '2026-04-10', amountCents: 50_000 }] });
    // Chaque mois : −10 000 (récurrence) − 30 000 (rythme) ; avril : + 50 000.
    expect(r.points.map((p) => p.balanceCents)).toEqual([100_000, 60_000, 20_000, 30_000]);
  });

  it.each([
    { ...BASE, months: 0 },
    { ...BASE, months: 601 },
    { ...BASE, windowMonths: 0 },
    { ...BASE, windowMonths: 1.5 },
    { ...BASE, windowSpendCents: -1 },
  ])('entrée invalide %o ⇒ RangeError', (input) => {
    expect(() => projection(input)).toThrow(RangeError);
  });
});
