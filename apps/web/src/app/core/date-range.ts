import { addDays, addMonths, lastDayOfMonth } from '@budgetracker/shared';

/** Période précédente de même durée : mêmes nombres de mois si la période couvre des mois entiers, sinon de jours. */
export function previousRange(from: string, to: string): { from: string; to: string } | null {
  if (from > to) return null;
  const end = addDays(from, -1);
  if (from.endsWith('-01') && to.slice(8) === lastDayOfMonth(to.slice(0, 7))) {
    const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
    return { from: addMonths(from, -months), to: end };
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  return { from: addDays(from, -days), to: end };
}
