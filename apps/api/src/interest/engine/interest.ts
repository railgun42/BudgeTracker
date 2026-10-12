import { addDays, isLocalDate, type LocalDate } from '@budgetracker/shared';

/** Solde de fin de journée à `date`, valable jusqu'au point suivant (0 avant le premier). */
export interface BalancePoint {
  date: LocalDate;
  balanceCents: number;
}

/** Taux annuel en points de base (300 = 3 %), applicable à partir de `effectiveDate`. */
export interface RatePoint {
  effectiveDate: LocalDate;
  rateBp: number;
}

export type YearlyInterest = { calculable: true; interestCents: number } | { calculable: false };

const byDate = <T>(key: (x: T) => LocalDate) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

function check(date: LocalDate, cents: number, what: string): void {
  if (!isLocalDate(date) || !Number.isSafeInteger(cents)) throw new RangeError(`${what} invalide : ${date} ${cents}`);
}

/**
 * Intérêts de l'année, modèle Livret A simplifié (PLAN, hypothèse 3) : quinzaines 1–15 et
 * 16–fin de mois ; base = minimum des soldes de fin de journée de la quinzaine (négatif ⇒ 0) ;
 * intérêt = base × taux / 24, arrondi au centime par quinzaine, sans capitalisation intra-année.
 * Taux d'une quinzaine = dernier `effectiveDate` ≤ son premier jour ; aucun ⇒ la quinzaine ne rapporte rien.
 * Aucun taux applicable de toute l'année ⇒ non calculable.
 */
export function yearlyInterest(dailyBalances: BalancePoint[], rates: RatePoint[], year: number): YearlyInterest {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`Année invalide : ${year}`);
  dailyBalances.forEach((b) => check(b.date, b.balanceCents, 'Solde'));
  rates.forEach((r) => {
    check(r.effectiveDate, r.rateBp, 'Taux');
    if (r.rateBp < 0) throw new RangeError(`Taux négatif : ${r.rateBp}`);
  });

  const balances = [...dailyBalances].sort(byDate((b) => b.date));
  const descRates = [...rates].sort(byDate((r) => r.effectiveDate)).reverse();
  const rateAt = (d: LocalDate) => descRates.find((r) => r.effectiveDate <= d)?.rateBp;

  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  if (rateAt(`${year}-12-16`) === undefined) return { calculable: false };

  let total = 0n;
  let bi = 0;
  let balance = 0;
  let min = Infinity;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    while (bi < balances.length && balances[bi].date <= d) balance = balances[bi++].balanceCents;
    min = Math.min(min, balance);
    const next = addDays(d, 1);
    if (!next.endsWith('-01') && !next.endsWith('-16')) continue;
    // Fin de quinzaine.
    const rate = rateAt(d.slice(0, 8) + (d.slice(8) <= '15' ? '01' : '16'));
    // BigInt : base × taux peut dépasser 2^53. Arrondi au plus proche, ½ vers le haut (base > 0).
    if (rate !== undefined && min > 0) total += (BigInt(min) * BigInt(rate) + 120_000n) / 240_000n;
    min = Infinity;
  }
  return { calculable: true, interestCents: Number(total) };
}
