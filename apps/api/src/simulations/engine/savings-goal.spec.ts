import { savingsGoal } from './savings-goal';

describe('savingsGoal', () => {
  it('5 000 € dans 12 mois, rien d’épargné ⇒ 416,67 €/mois (arrondi supérieur), 0 %', () => {
    expect(savingsGoal({ targetCents: 500_000, months: 12, savedCents: 0 })).toEqual({ savedCents: 0, remainingCents: 500_000, monthlyCents: 41_667, progressBp: 0 });
  });

  it('un quart épargné ⇒ 25 %, effort sur le reste', () => {
    expect(savingsGoal({ targetCents: 500_000, months: 12, savedCents: 125_000 })).toEqual({ savedCents: 125_000, remainingCents: 375_000, monthlyCents: 31_250, progressBp: 2_500 });
  });

  it('effort × mois couvre toujours le reste', () => {
    const { remainingCents, monthlyCents } = savingsGoal({ targetCents: 100_001, months: 7, savedCents: 3 });
    expect(monthlyCents * 7).toBeGreaterThanOrEqual(remainingCents);
    expect((monthlyCents - 1) * 7).toBeLessThan(remainingCents);
  });

  it('objectif dépassé ⇒ effort 0, progression plafonnée à 100 %', () => {
    expect(savingsGoal({ targetCents: 500_000, months: 12, savedCents: 600_000 })).toEqual({ savedCents: 600_000, remainingCents: 0, monthlyCents: 0, progressBp: 10_000 });
  });

  it('solde négatif ⇒ progression 0, le découvert s’ajoute au reste', () => {
    expect(savingsGoal({ targetCents: 500_000, months: 12, savedCents: -10_000 })).toEqual({ savedCents: -10_000, remainingCents: 510_000, monthlyCents: 42_500, progressBp: 0 });
  });

  it.each([
    { targetCents: 0, months: 12, savedCents: 0 },
    { targetCents: 100_000_000_001, months: 12, savedCents: 0 },
    { targetCents: 1_000, months: 0, savedCents: 0 },
    { targetCents: 1_000, months: 12, savedCents: 0.5 },
  ])('entrée invalide %o ⇒ RangeError', (input) => {
    expect(() => savingsGoal(input)).toThrow(RangeError);
  });
});
