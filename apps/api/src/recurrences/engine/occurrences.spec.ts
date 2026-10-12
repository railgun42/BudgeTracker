import { addDays, IntervalUnit } from '@budgetracker/shared';
import { occurrencesBetween, type RecurrenceRule } from './occurrences';

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({
  startDate: '2024-01-31',
  endDate: null,
  interval: 1,
  unit: IntervalUnit.MONTH,
  ...r,
});

describe('occurrencesBetween', () => {
  it('mensuel ancré au 31 : dernier jour des mois courts, sans dérive', () => {
    expect(occurrencesBetween(rule({ startDate: '2023-01-31' }), '2023-01-01', '2023-05-31')).toEqual([
      '2023-01-31',
      '2023-02-28',
      '2023-03-31',
      '2023-04-30',
      '2023-05-31',
    ]);
  });

  it('annuel au 29/02 : 28/02 les années non bissextiles, puis 29/02', () => {
    const r = rule({ startDate: '2024-02-29', unit: IntervalUnit.YEAR });
    expect(occurrencesBetween(r, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('toutes les 2 semaines', () => {
    const r = rule({ startDate: '2024-01-01', unit: IntervalUnit.WEEK, interval: 2 });
    expect(occurrencesBetween(r, '2024-01-01', '2024-02-29')).toEqual([
      '2024-01-01',
      '2024-01-15',
      '2024-01-29',
      '2024-02-12',
      '2024-02-26',
    ]);
  });

  it('quotidien avec intervalle, fenêtre ne commençant pas sur une occurrence', () => {
    const r = rule({ startDate: '2024-02-27', unit: IntervalUnit.DAY, interval: 2 });
    expect(occurrencesBetween(r, '2024-02-28', '2024-03-04')).toEqual(['2024-02-29', '2024-03-02', '2024-03-04']);
  });

  it('rattrapage de 14 mois : toutes les occurrences dues', () => {
    const r = rule({ startDate: '2024-01-15' });
    const got = occurrencesBetween(r, '2024-01-15', '2025-03-15');
    expect(got).toHaveLength(15);
    expect(got[0]).toBe('2024-01-15');
    expect(got[14]).toBe('2025-03-15');
  });

  it('endDate inclusive', () => {
    const r = rule({ startDate: '2024-01-10', endDate: '2024-03-10' });
    expect(occurrencesBetween(r, '2024-01-01', '2024-12-31')).toEqual(['2024-01-10', '2024-02-10', '2024-03-10']);
    expect(occurrencesBetween({ ...r, endDate: '2024-03-09' }, '2024-01-01', '2024-12-31')).toEqual([
      '2024-01-10',
      '2024-02-10',
    ]);
  });

  it('rien avant startDate, fenêtre vide ou inversée', () => {
    const r = rule({ startDate: '2024-06-30' });
    expect(occurrencesBetween(r, '2024-01-01', '2024-06-29')).toEqual([]);
    expect(occurrencesBetween(r, '2024-08-01', '2024-07-01')).toEqual([]);
  });

  it('résultat identique quel que soit le découpage de la fenêtre', () => {
    const rules = [
      rule({ startDate: '2023-01-31' }),
      rule({ startDate: '2024-02-29', unit: IntervalUnit.YEAR }),
      rule({ startDate: '2023-03-03', unit: IntervalUnit.WEEK, interval: 3 }),
      rule({ startDate: '2023-01-01', unit: IntervalUnit.DAY, interval: 5, endDate: '2024-11-11' }),
      rule({ startDate: '2023-05-31', interval: 3 }),
    ];
    const from = '2023-01-01';
    const to = '2025-12-31';
    for (const r of rules) {
      const whole = occurrencesBetween(r, from, to);
      for (const cutStep of [1, 7, 30, 45, 400]) {
        const pieces: string[] = [];
        for (let a = from; a <= to; a = addDays(a, cutStep)) {
          const b = addDays(a, cutStep - 1);
          pieces.push(...occurrencesBetween(r, a, b < to ? b : to));
        }
        expect(pieces).toEqual(whole);
      }
    }
  });

  it('refuse un intervalle non entier ou < 1', () => {
    for (const interval of [0, -1, 1.5]) {
      expect(() => occurrencesBetween(rule({ interval }), '2024-01-01', '2024-12-31')).toThrow(RangeError);
    }
  });
});
