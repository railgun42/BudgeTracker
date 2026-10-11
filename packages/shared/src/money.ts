// Montants : entiers en centimes (SPEC §3.1). Seul endroit où l'on convertit € ⇄ centimes.

// Signe optionnel, 1 à 13 chiffres (≤ 10¹⁵ centimes, exact en number), 0 à 2 décimales,
// séparateur « , » ou « . ». Pas d'exposant (« 1e3 »), pas de « .5 » ni de « 12, ».
const EUROS = /^(-?)(\d{1,13})(?:[.,](\d{1,2}))?$/;

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function assertCents(cents: number): void {
  // Message sans le montant : il peut finir dans les logs.
  if (!Number.isSafeInteger(cents)) throw new RangeError('Montant en centimes attendu (entier)');
}

/** Saisie utilisateur → centimes : '12,34' → 1234. Invalide → null. Calcul sur la chaîne, jamais en float. */
export function eurosToCents(input: string): number | null {
  // Espaces ignorés (y compris insécables) : « 1 234,56 » est accepté.
  const m = EUROS.exec(input.replace(/\s/g, ''));
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] && cents !== 0 ? -cents : cents;
}

/** Centimes → valeur de champ de saisie : 1234 → '12,34' (sans séparateur de milliers). */
export function centsToEuros(cents: number): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const rest = abs % 100;
  return `${cents < 0 ? '-' : ''}${(abs - rest) / 100},${String(rest).padStart(2, '0')}`;
}

/** Centimes → affichage : 123456 → '1 234,56 €' (espaces insécables, format fr-FR). */
export function formatEur(cents: number): string {
  assertCents(cents);
  return EUR.format(cents / 100);
}
