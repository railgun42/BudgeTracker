// Jour calendaire 'YYYY-MM-DD', sans heure ni fuseau (SPEC §3.1). Deux LocalDate se
// comparent directement (<, >, ===) : l'ordre lexicographique est l'ordre chronologique.
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Calculs en UTC pour ignorer le fuseau local. setUTCFullYear plutôt que Date.UTC,
// qui envoie les années 0–99 en 1900–1999. Les débordements (jour 0, mois 13) se normalisent.
function utc(y: number, m: number, d: number): Date {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const format = (t: Date): LocalDate =>
  `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const daysInMonth = (y: number, m: number) => utc(y, m + 1, 0).getUTCDate();

function parse(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE.exec(date);
  // Aller-retour : rejette les jours inexistants (2023-02-29, 2024-13-01).
  if (m && format(utc(+m[1], +m[2], +m[3])) === date) return [+m[1], +m[2], +m[3]];
  throw new RangeError(`Date invalide (YYYY-MM-DD attendu) : ${date}`);
}

function assertInteger(n: number): void {
  if (!Number.isInteger(n)) throw new RangeError(`Entier attendu : ${n}`);
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

/** addDays('2024-02-28', 1) === '2024-02-29' ; n négatif accepté. */
export function addDays(date: LocalDate, n: number): LocalDate {
  assertInteger(n);
  const [y, m, d] = parse(date);
  return format(utc(y, m, d + n));
}

/** Ramené au dernier jour des mois courts : addMonths('2024-01-31', 1) === '2024-02-29'. */
export function addMonths(date: LocalDate, n: number): LocalDate {
  assertInteger(n);
  const [y, m, d] = parse(date);
  const target = utc(y, m + n, 1); // normalise année et mois, y compris n négatif
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return format(utc(ty, tm, Math.min(d, daysInMonth(ty, tm))));
}

/** Dernier jour du mois 'YYYY-MM', sur deux chiffres : lastDayOfMonth('2024-02') === '29'. */
export function lastDayOfMonth(yearMonth: string): string {
  const m = YEAR_MONTH.exec(yearMonth);
  if (!m) throw new RangeError(`Mois invalide (YYYY-MM attendu) : ${yearMonth}`);
  return pad(daysInMonth(+m[1], +m[2]));
}
