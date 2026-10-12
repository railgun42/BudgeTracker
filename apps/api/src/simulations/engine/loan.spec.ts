import { loan } from './loan';

describe('loan', () => {
  it('prêt de référence : 10 000 € / 5 % / 60 mois ⇒ 188,71 €', () => {
    // Formule exacte : 60 × 188,7123… − 10 000 = 1 322,74 €. La mensualité arrondie à 188,71 laisse 0,23 c
    // par mois, rattrapés (avec leurs intérêts) par la dernière : 188,85 €.
    expect(loan({ principalCents: 1_000_000, annualRateBp: 500, months: 60 })).toEqual({
      monthlyPaymentCents: 18_871,
      lastPaymentCents: 18_885,
      totalPaidCents: 1_132_274,
      totalInterestCents: 132_274,
    });
  });

  it('coût total = mensualités − capital', () => {
    const r = loan({ principalCents: 1_000_000, annualRateBp: 500, months: 60 });
    expect(r.totalPaidCents).toBe(59 * r.monthlyPaymentCents + r.lastPaymentCents);
    expect(r.totalInterestCents).toBe(r.totalPaidCents - 1_000_000);
  });

  it('taux 0 % ⇒ capital / durée, dernière mensualité ajustée, coût nul', () => {
    // 10 000 € / 60 = 166,666… ⇒ 59 × 166,67 + 166,47.
    expect(loan({ principalCents: 1_000_000, annualRateBp: 0, months: 60 })).toEqual({
      monthlyPaymentCents: 16_667,
      lastPaymentCents: 16_647,
      totalPaidCents: 1_000_000,
      totalInterestCents: 0,
    });
  });

  it('un seul mois ⇒ capital + un mois d’intérêts', () => {
    // 1 200 € à 12 % : 1 % sur un mois = 12 €.
    expect(loan({ principalCents: 120_000, annualRateBp: 1_200, months: 1 })).toEqual({
      monthlyPaymentCents: 121_200,
      lastPaymentCents: 121_200,
      totalPaidCents: 121_200,
      totalInterestCents: 1_200,
    });
  });

  it('bornes maximales : résultat entier sûr', () => {
    const r = loan({ principalCents: 100_000_000_000, annualRateBp: 2_000, months: 600 });
    expect(Number.isSafeInteger(r.totalPaidCents)).toBe(true);
    expect(r.totalInterestCents).toBe(r.totalPaidCents - 100_000_000_000);
  });

  it.each([
    { principalCents: 0, annualRateBp: 500, months: 60 },
    { principalCents: 10.5, annualRateBp: 500, months: 60 },
    { principalCents: 1_000, annualRateBp: -1, months: 60 },
    { principalCents: 1_000, annualRateBp: 2_001, months: 60 },
    { principalCents: 1_000, annualRateBp: 500, months: 0 },
    { principalCents: 1_000, annualRateBp: 500, months: 601 },
  ])('entrée invalide %o ⇒ RangeError', (input) => {
    expect(() => loan(input)).toThrow(RangeError);
  });
});
