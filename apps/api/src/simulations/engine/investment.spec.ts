import { investment } from './investment';

// 10 000 € à 5 % sur 10 ans, capitalisation mensuelle : 10 000 × (1 + 0,05/12)^120 = 16 470,09 €.
const TEN_K = { initialCents: 1_000_000, annualRateBp: 500, months: 120 };

describe('investment', () => {
  it('intérêts composés sans inflation : valeur réelle = valeur nominale', () => {
    expect(investment(TEN_K)).toEqual({
      finalCents: 1_647_009,
      contributedCents: 1_000_000,
      interestCents: 647_009,
      realFinalCents: 1_647_009,
    });
  });

  it('avec inflation 2 % : 16 470,09 / 1,02^10 = 13 511,21 €', () => {
    expect(investment({ ...TEN_K, inflationBp: 200 })).toMatchObject({ finalCents: 1_647_009, realFinalCents: 1_351_121 });
  });

  it('versements mensuels en fin de mois', () => {
    // + 100 €/mois : 100 × ((1 + r)^120 − 1) / r = 15 528,23 € ; versé = 10 000 + 120 × 100.
    expect(investment({ ...TEN_K, monthlyContributionCents: 10_000, inflationBp: 200 })).toEqual({
      finalCents: 3_199_832,
      contributedCents: 2_200_000,
      interestCents: 999_832,
      realFinalCents: 2_624_977,
    });
  });

  it('taux 0 % ⇒ somme des versements, érodée par l’inflation', () => {
    const r = investment({ initialCents: 1_000_000, monthlyContributionCents: 10_000, annualRateBp: 0, months: 12, inflationBp: 1_000 });
    expect(r).toEqual({ finalCents: 1_120_000, contributedCents: 1_120_000, interestCents: 0, realFinalCents: 1_018_182 });
  });

  it('bornes maximales : résultat entier sûr', () => {
    const r = investment({ initialCents: 100_000_000_000, monthlyContributionCents: 1_000_000_000, annualRateBp: 2_000, months: 600 });
    expect(Number.isSafeInteger(r.finalCents)).toBe(true);
  });

  it.each([
    { ...TEN_K, initialCents: -1 },
    { ...TEN_K, monthlyContributionCents: 1.5 },
    { ...TEN_K, annualRateBp: 2_001 },
    { ...TEN_K, months: 0 },
    { ...TEN_K, inflationBp: -1 },
  ])('entrée invalide %o ⇒ RangeError', (input) => {
    expect(() => investment(input)).toThrow(RangeError);
  });
});
