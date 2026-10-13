import { projection, type ProjectionInput } from './projection';
import { applyScenario } from './scenario';

const BASE: ProjectionInput = {
  today: '2026-01-31',
  months: 3,
  balanceCents: 100_000,
  planned: [{ date: '2026-02-10', amountCents: -5_000 }],
  recurrences: [],
  windowSpendCents: 30_000,
  windowMonths: 3,
};
const balances = (input: ProjectionInput) => projection(input).points.map((p) => p.balanceCents);

describe('applyScenario', () => {
  it('sans modification ⇒ même projection ; l’entrée n’est jamais modifiée', () => {
    const copy = structuredClone(BASE);
    expect(projection(applyScenario(BASE, [], {}))).toEqual(projection(BASE));
    applyScenario(BASE, [{ kind: 'SUBSCRIPTION', monthlyCents: 1_000 }], {});
    expect(BASE).toEqual(copy);
  });

  it('abonnement : débit mensuel à today + k mois, sans dérive de fin de mois', () => {
    const input = applyScenario(BASE, [{ kind: 'SUBSCRIPTION', monthlyCents: 1_500 }], {});
    expect(input.planned.slice(1)).toEqual([
      { date: '2026-02-28', amountCents: -1_500 },
      { date: '2026-03-31', amountCents: -1_500 },
      { date: '2026-04-30', amountCents: -1_500 },
    ]);
    // Base : 100 000 → 85 000 → 75 000 → 65 000 (rythme 10 000, −5 000 le 10/02).
    expect(balances(input)).toEqual([100_000, 83_500, 72_000, 60_500]);
  });

  it('catégorie −100 €/mois : économie plafonnée à la dépense réelle de la catégorie', () => {
    const change = { kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: -10_000 } as const;
    expect(balances(applyScenario(BASE, [change], { c1: 25_000 }))).toEqual([100_000, 95_000, 95_000, 95_000]);
    expect(balances(applyScenario(BASE, [change], { c1: 4_000 }))).toEqual([100_000, 89_000, 83_000, 77_000]);
    expect(balances(applyScenario(BASE, [change], {}))).toEqual(balances(BASE)); // catégorie sans dépense
  });

  it('catégorie +50 €/mois : hausse non plafonnée', () => {
    const change = { kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: 5_000 } as const;
    expect(balances(applyScenario(BASE, [change], {}))).toEqual([100_000, 80_000, 65_000, 50_000]);
  });

  it('achat à crédit : mensualités du calculateur, s’arrêtent à la fin du prêt', () => {
    // 1 000 € à 0 % sur 2 mois ⇒ 2 × 500 €.
    const input = applyScenario(BASE, [{ kind: 'LOAN', principalCents: 100_000, annualRateBp: 0, months: 2 }], {});
    expect(input.planned.slice(1).map((e) => e.amountCents)).toEqual([-50_000, -50_000]);
    // 100 € à 0 % sur 3 mois ⇒ 33,33 + 33,33 + 33,34 (la dernière absorbe l'arrondi).
    const odd = applyScenario(BASE, [{ kind: 'LOAN', principalCents: 10_000, annualRateBp: 0, months: 3 }], {});
    expect(odd.planned.slice(1).map((e) => e.amountCents)).toEqual([-3_333, -3_333, -3_334]);
    // Prêt plus long que l'horizon : seulement les mois projetés. 10 000 € / 5 % / 60 mois ⇒ 188,71 €.
    const long = applyScenario(BASE, [{ kind: 'LOAN', principalCents: 1_000_000, annualRateBp: 500, months: 60 }], {});
    expect(long.planned.slice(1).map((e) => e.amountCents)).toEqual([-18_871, -18_871, -18_871]);
  });

  it('plusieurs modifications se cumulent', () => {
    const input = applyScenario(
      BASE,
      [
        { kind: 'SUBSCRIPTION', monthlyCents: 1_000 },
        { kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: -3_000 },
      ],
      { c1: 9_000 },
    );
    expect(balances(input)).toEqual([100_000, 87_000, 79_000, 71_000]);
  });

  it.each([
    { kind: 'SUBSCRIPTION', monthlyCents: 0 },
    { kind: 'SUBSCRIPTION', monthlyCents: 1.5 },
    { kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: 2_000_000_000 },
    { kind: 'LOAN', principalCents: 0, annualRateBp: 0, months: 2 },
  ] as const)('paramètre hors bornes %o ⇒ RangeError', (change) => {
    expect(() => applyScenario(BASE, [change], {})).toThrow(RangeError);
  });
});
