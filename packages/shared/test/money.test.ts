import { describe, expect, it } from 'vitest';
import { centsToEuros, eurosToCents, formatEur } from '../src/money';

// Intl utilise des espaces insécables (U+00A0 / U+202F) : on les normalise pour comparer.
const spaces = (s: string) => s.replace(/\s/g, ' ');

describe('eurosToCents', () => {
  it.each([
    ['12,34', 1234],
    ['12.34', 1234],
    ['12', 1200],
    ['12,5', 1250],
    ['0,05', 5],
    ['  7,00 ', 700],
    ['1 234,56', 123456],
    ['-3,10', -310],
    ['-0', 0],
    ['9999999999999,99', 999999999999999],
  ])('%s → %i', (input, cents) => {
    expect(eurosToCents(input)).toBe(cents);
  });

  it('0.1 + 0.2 ne dérive pas (calcul sur la chaîne, pas en float)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // le piège évité
    expect(eurosToCents('0.1')! + eurosToCents('0.2')!).toBe(eurosToCents('0.3'));
    // Valeurs où `x * 100` en float tombe à côté (4.35 * 100 = 434.99999999999994).
    expect(eurosToCents('4,35')).toBe(435);
    expect(eurosToCents('1.15')).toBe(115);
    expect(eurosToCents('0,29')).toBe(29);
  });

  it.each(['1e3', '', ' ', 'abc', '12,345', ',5', '12,', '1,2,3', '+5', '--1', '12€', 'Infinity', 'NaN', '0x10', '10000000000000'])(
    'rejette %j',
    (input) => {
      expect(eurosToCents(input)).toBeNull();
    },
  );
});

describe('centsToEuros', () => {
  it.each([
    [1234, '12,34'],
    [5, '0,05'],
    [0, '0,00'],
    [-310, '-3,10'],
    [-5, '-0,05'],
    [999999999999999, '9999999999999,99'],
  ])('%i → %s', (cents, euros) => {
    expect(centsToEuros(cents)).toBe(euros);
  });

  it('aller-retour avec eurosToCents', () => {
    for (const cents of [0, 1, 99, 100, 435, 123456, -42]) expect(eurosToCents(centsToEuros(cents))).toBe(cents);
  });

  it.each([1.5, NaN, Infinity, 2 ** 53])('refuse %d (pas des centimes entiers)', (v) => {
    expect(() => centsToEuros(v)).toThrow(RangeError);
  });
});

describe('formatEur', () => {
  it('formate en fr-FR', () => {
    expect(spaces(formatEur(1234))).toBe('12,34 €');
    expect(spaces(formatEur(123456789))).toBe('1 234 567,89 €');
    expect(spaces(formatEur(5))).toBe('0,05 €');
    expect(spaces(formatEur(-310))).toMatch(/^-3,10 €$/);
  });

  it('refuse un montant non entier', () => {
    expect(() => formatEur(12.34)).toThrow(RangeError);
  });
});
