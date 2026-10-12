import { yearlyInterest, type BalancePoint, type RatePoint } from './interest';

// 10 000 € à 3 % : 1 000 000 × 300 / 240 000 = 1 250 c par quinzaine, 24 quinzaines.
const TEN_K: BalancePoint[] = [{ date: '2023-12-31', balanceCents: 1_000_000 }];
const THREE_PCT: RatePoint[] = [{ effectiveDate: '2020-01-01', rateBp: 300 }];

describe('yearlyInterest', () => {
  it('solde constant ⇒ taux × solde', () => {
    expect(yearlyInterest(TEN_K, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 30_000 });
  });

  it('retrait en milieu de quinzaine ⇒ minimum de la quinzaine retenu', () => {
    // 6 000 € retirés le 10/03 et remis le 11/03 : la quinzaine 1–15 mars est calculée sur 4 000 € (500 c).
    const balances: BalancePoint[] = [
      ...TEN_K,
      { date: '2024-03-10', balanceCents: 400_000 },
      { date: '2024-03-11', balanceCents: 1_000_000 },
    ];
    expect(yearlyInterest(balances, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 23 * 1_250 + 500 });
  });

  it('dépôt en milieu de quinzaine ⇒ ne rapporte qu’à partir de la suivante', () => {
    const balances: BalancePoint[] = [{ date: '2024-01-05', balanceCents: 1_000_000 }];
    expect(yearlyInterest(balances, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 23 * 1_250 });
  });

  it('changement de taux en cours d’année (au 1er de la quinzaine)', () => {
    // 3 % en janvier (2 × 1 250), 2,4 % ensuite (22 × 1 000).
    const rates: RatePoint[] = [...THREE_PCT, { effectiveDate: '2025-02-01', rateBp: 240 }];
    expect(yearlyInterest(TEN_K, rates, 2025)).toEqual({ calculable: true, interestCents: 2 * 1_250 + 22 * 1_000 });
  });

  it('taux effectif en milieu de quinzaine ⇒ appliqué à la quinzaine suivante', () => {
    const rates: RatePoint[] = [{ effectiveDate: '2025-02-05', rateBp: 240 }, ...THREE_PCT]; // ordre quelconque
    expect(yearlyInterest(TEN_K, rates, 2025)).toEqual({ calculable: true, interestCents: 3 * 1_250 + 21 * 1_000 });
  });

  it('premier taux en cours d’année ⇒ quinzaines antérieures à 0', () => {
    const rates: RatePoint[] = [{ effectiveDate: '2024-07-01', rateBp: 300 }];
    expect(yearlyInterest(TEN_K, rates, 2024)).toEqual({ calculable: true, interestCents: 12 * 1_250 });
  });

  it('taux absent ⇒ non calculable', () => {
    expect(yearlyInterest(TEN_K, [], 2024)).toEqual({ calculable: false });
    // Taux postérieur au début de la dernière quinzaine : ne s'applique à aucune quinzaine de l'année.
    expect(yearlyInterest(TEN_K, [{ effectiveDate: '2024-12-20', rateBp: 300 }], 2024)).toEqual({ calculable: false });
  });

  it('arrondi au centime par quinzaine, ½ vers le haut', () => {
    // 123,45 € : 15,43 c → 15 c par quinzaine (360 c, et non 370 c d'un arrondi annuel).
    expect(yearlyInterest([{ date: '2024-01-01', balanceCents: 12_345 }], THREE_PCT, 2024)).toEqual({
      calculable: true,
      interestCents: 360,
    });
    // 4 € : exactement 0,5 c par quinzaine → 1 c.
    expect(yearlyInterest([{ date: '2024-01-01', balanceCents: 400 }], THREE_PCT, 2024)).toEqual({
      calculable: true,
      interestCents: 24,
    });
  });

  it('solde nul ou négatif ⇒ aucun intérêt ; solde vide ⇒ 0', () => {
    const negative: BalancePoint[] = [...TEN_K, { date: '2024-06-20', balanceCents: -5_000 }];
    // Quinzaine du 16/06 au 30/06 et suivantes à 0 : 11 quinzaines rémunérées.
    expect(yearlyInterest(negative, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 11 * 1_250 });
    expect(yearlyInterest([], THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 0 });
  });

  it('ignore les mouvements des autres années', () => {
    const balances: BalancePoint[] = [...TEN_K, { date: '2025-01-01', balanceCents: 0 }];
    expect(yearlyInterest(balances, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: 30_000 });
  });

  it('grands montants sans perte de précision', () => {
    // 9·10¹⁵ c × 300 dépasse 2^53 : le calcul reste exact.
    const big: BalancePoint[] = [{ date: '2024-01-01', balanceCents: 9_000_000_000_000_000 }];
    const per = (9_000_000_000_000_000n * 300n) / 240_000n;
    expect(yearlyInterest(big, THREE_PCT, 2024)).toEqual({ calculable: true, interestCents: Number(per * 24n) });
  });

  it('refuse les entrées invalides', () => {
    expect(() => yearlyInterest(TEN_K, THREE_PCT, 2024.5)).toThrow(RangeError);
    expect(() => yearlyInterest([{ date: '2024-02-30', balanceCents: 1 }], THREE_PCT, 2024)).toThrow(RangeError);
    expect(() => yearlyInterest([{ date: '2024-01-01', balanceCents: 1.5 }], THREE_PCT, 2024)).toThrow(RangeError);
    expect(() => yearlyInterest(TEN_K, [{ effectiveDate: '2024-01-01', rateBp: -1 }], 2024)).toThrow(RangeError);
    expect(() => yearlyInterest(TEN_K, [{ effectiveDate: '2024-01-01', rateBp: 2.5 }], 2024)).toThrow(RangeError);
  });
});
