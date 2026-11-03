import { TrackingType } from '@budgetracker/shared';
import { balanceSeries, type SeriesAccount } from './balance-series';

const account = (a: Partial<SeriesAccount>): SeriesAccount => ({ accountId: 'A', trackingType: TrackingType.NORMAL, openingDate: null, rows: [], ...a });

describe('balanceSeries', () => {
  it('cumule depuis le solde d’avant la fenêtre ; jour sans transaction = veille', () => {
    const rows = [
      { date: null, sameDay: true, cents: 10_000 },
      { date: '2026-03-02', sameDay: true, cents: -2_500 },
    ];
    expect(balanceSeries([account({ rows })], '2026-03-01', '2026-03-03')).toEqual({
      dates: ['2026-03-01', '2026-03-02', '2026-03-03'],
      accounts: [{ accountId: 'A', balancesCents: [10_000, 7_500, 7_500] }],
      totalCents: [10_000, 7_500, 7_500],
    });
  });

  it('transaction antérieure au solde de départ : courbe inchangée', () => {
    const opening = { date: '2026-03-03', sameDay: true, cents: 50_000 };
    const without = balanceSeries([account({ openingDate: '2026-03-03', rows: [opening] })], '2026-03-01', '2026-03-04');
    const withEarlier = balanceSeries([account({ openingDate: '2026-03-03', rows: [opening, { date: '2026-03-02', sameDay: true, cents: -1_000 }] })], '2026-03-01', '2026-03-04');
    expect(withEarlier).toEqual(without);
    expect(without.totalCents).toEqual([0, 0, 50_000, 50_000]);
  });

  it('jour du solde de départ : comptée si countInBalance ≠ false, ignorée sinon', () => {
    const rows = (sameDay: boolean) => [
      { date: '2026-03-02', sameDay: true, cents: 50_000 }, // le solde de départ lui-même
      { date: '2026-03-02', sameDay, cents: -1_000 },
    ];
    const run = (sameDay: boolean) => balanceSeries([account({ openingDate: '2026-03-02', rows: rows(sameDay) })], '2026-03-02', '2026-03-02').totalCents;
    expect(run(true)).toEqual([49_000]);
    expect(run(false)).toEqual([50_000]);
  });

  it('virement entre deux comptes : chaque compte bouge, total plat', () => {
    const start = { date: null, sameDay: true, cents: 1_000 };
    const out = balanceSeries(
      [
        account({ accountId: 'A', rows: [start, { date: '2026-03-02', sameDay: true, cents: -300 }] }),
        account({ accountId: 'B', rows: [start, { date: '2026-03-02', sameDay: true, cents: 300 }] }),
      ],
      '2026-03-01',
      '2026-03-02',
    );
    expect(out.accounts.map((a) => a.balancesCents)).toEqual([
      [1_000, 700],
      [1_000, 1_300],
    ]);
    expect(out.totalCents).toEqual([2_000, 2_000]);
  });

  it('compte NOT_TRACKED exclu des comptes et du total', () => {
    const out = balanceSeries(
      [account({ rows: [{ date: null, sameDay: true, cents: 1_000 }] }), account({ accountId: 'W', trackingType: TrackingType.NOT_TRACKED, rows: [{ date: '2026-03-01', sameDay: true, cents: -400 }] })],
      '2026-03-01',
      '2026-03-01',
    );
    expect(out.accounts.map((a) => a.accountId)).toEqual(['A']);
    expect(out.totalCents).toEqual([1_000]);
  });

  it('fenêtre d’un jour ; sans compte, total à 0', () => {
    expect(balanceSeries([account({ rows: [{ date: '2026-03-01', sameDay: true, cents: 42 }] })], '2026-03-01', '2026-03-01').totalCents).toEqual([42]);
    expect(balanceSeries([], '2026-03-01', '2026-03-01')).toEqual({ dates: ['2026-03-01'], accounts: [], totalCents: [0] });
  });
});
