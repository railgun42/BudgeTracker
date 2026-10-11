import { describe, expect, it } from 'vitest';
import { addDays, addMonths, isLocalDate, lastDayOfMonth } from '../src/local-date';

describe('lastDayOfMonth', () => {
  it.each([
    ['2024-02', '29'], // bissextile
    ['2023-02', '28'],
    ['2000-02', '29'], // divisible par 400
    ['1900-02', '28'], // divisible par 100
    ['2024-04', '30'],
    ['2024-12', '31'],
    ['0050-02', '28'], // pas de bascule en 1950 (piège de Date.UTC)
  ])('%s → %s', (ym, day) => {
    expect(lastDayOfMonth(ym)).toBe(day);
  });

  it.each(['2024-13', '2024-00', '2024-2', '2024-02-01', ''])('rejette %j', (ym) => {
    expect(() => lastDayOfMonth(ym)).toThrow(RangeError);
  });
});

describe('isLocalDate', () => {
  it.each(['2024-02-29', '2023-12-31', '0001-01-01'])('accepte %s', (d) => {
    expect(isLocalDate(d)).toBe(true);
  });

  it.each(['2023-02-29', '2024-13-01', '2024-04-31', '2024-1-01', '2024-01-01T00:00:00Z', '', 20240101, null])(
    'rejette %j',
    (d) => {
      expect(isLocalDate(d)).toBe(false);
    },
  );
});

describe('addDays', () => {
  it.each([
    ['2024-02-28', 1, '2024-02-29'],
    ['2023-02-28', 1, '2023-03-01'],
    ['2024-12-31', 1, '2025-01-01'],
    ['2025-01-01', -1, '2024-12-31'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2024-01-01', 366, '2025-01-01'],
    ['2024-05-10', 0, '2024-05-10'],
  ])('%s + %i j → %s', (d, n, expected) => {
    expect(addDays(d, n)).toBe(expected);
  });

  it('indépendant du changement d’heure (dernier dimanche de mars / octobre)', () => {
    expect(addDays('2024-03-30', 1)).toBe('2024-03-31');
    expect(addDays('2024-03-31', 1)).toBe('2024-04-01');
    expect(addDays('2024-10-27', 1)).toBe('2024-10-28');
  });

  it('rejette une date invalide ou un nombre de jours non entier', () => {
    expect(() => addDays('2023-02-29', 1)).toThrow(RangeError);
    expect(() => addDays('2024-01-01', 1.5)).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it.each([
    ['2024-01-31', 1, '2024-02-29'],
    ['2023-01-31', 1, '2023-02-28'],
    ['2024-01-31', 2, '2024-03-31'], // depuis l'ancrage : pas de dérive vers le 29
    ['2024-01-31', 3, '2024-04-30'],
    ['2024-03-31', -1, '2024-02-29'],
    ['2024-11-15', 2, '2025-01-15'],
    ['2024-01-15', -13, '2022-12-15'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
  ])('%s + %i mois → %s', (d, n, expected) => {
    expect(addMonths(d, n)).toBe(expected);
  });

  it('rejette une date invalide ou un nombre de mois non entier', () => {
    expect(() => addMonths('2024-02-30', 1)).toThrow(RangeError);
    expect(() => addMonths('2024-01-01', 0.5)).toThrow(RangeError);
  });
});
