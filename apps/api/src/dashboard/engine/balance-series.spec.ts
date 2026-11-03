import { TrackingType } from '@budgetracker/shared';
import { balanceSeries, type DayRow, type SeriesAccount } from './balance-series';

const account = (a: Partial<SeriesAccount>): SeriesAccount => ({ accountId: 'A', trackingType: TrackingType.NORMAL, openingDate: null, rows: [], ...a });
const row = (date: string | null, cents: number, r: Partial<DayRow> = {}): DayRow => ({ date, counted: true, opening: false, cents, ...r });
const opening = (date: string, cents: number): DayRow => row(date, cents, { opening: true });
/** Mouvement antérieur au solde de départ (ou du jour, non compté) : compris dans le solde saisi. */
const earlier = (date: string | null, cents: number): DayRow => row(date, cents, { counted: false });

describe('balanceSeries', () => {
  it('cumule depuis le solde d’avant la fenêtre ; jour sans transaction = veille', () => {
    const rows = [row(null, 10_000), row('2026-03-02', -2_500)];
    expect(balanceSeries([account({ rows })], '2026-03-01', '2026-03-03')).toEqual({
      dates: ['2026-03-01', '2026-03-02', '2026-03-03'],
      accounts: [{ accountId: 'A', balancesCents: [10_000, 7_500, 7_500] }],
      totalCents: [10_000, 7_500, 7_500],
    });
  });

  it('historique antérieur au solde de départ : courbe reconstituée à rebours, continue jusqu’au solde de départ', () => {
    // 510,00 € avant la dépense de 10,00 € du 02/03 ; solde de départ saisi : 500,00 € le 03/03.
    const rows = [opening('2026-03-03', 50_000), earlier('2026-03-02', -1_000), earlier(null, -100)];
    const out = balanceSeries([account({ openingDate: '2026-03-03', rows })], '2026-03-01', '2026-03-04');
    expect(out.totalCents).toEqual([51_000, 50_000, 50_000, 50_000]);
  });

  it('fenêtre entièrement avant le solde de départ, mouvements non comptés au-delà de sa fin', () => {
    const rows = [opening('2026-03-10', 50_000), earlier('2026-03-02', -1_000), earlier('2026-03-08', -2_000)];
    const out = balanceSeries([account({ openingDate: '2026-03-10', rows })], '2026-03-01', '2026-03-02');
    expect(out.totalCents).toEqual([53_000, 52_000]);
  });

  it('jour du solde de départ : compté ou non selon countInBalance ; la veille défait ce qui est déjà compris', () => {
    const run = (counted: boolean) =>
      balanceSeries([account({ openingDate: '2026-03-02', rows: [opening('2026-03-02', 50_000), row('2026-03-02', -1_000, { counted })] })], '2026-03-01', '2026-03-02').totalCents;
    expect(run(true)).toEqual([50_000, 49_000]); // compté : tombé après la saisie, la veille est le solde saisi
    expect(run(false)).toEqual([51_000, 50_000]); // non compté : déjà compris dans le solde saisi
  });

  it('un solde de départ plus ancien (remplacé) n’entre pas dans la reconstitution', () => {
    const rows = [opening('2026-03-03', 50_000), row('2026-01-01', 99_999, { counted: false, opening: true })];
    expect(balanceSeries([account({ openingDate: '2026-03-03', rows })], '2026-03-01', '2026-03-03').totalCents).toEqual([50_000, 50_000, 50_000]);
  });

  it('virement entre deux comptes : chaque compte bouge, total plat', () => {
    const start = row(null, 1_000);
    const out = balanceSeries(
      [account({ accountId: 'A', rows: [start, row('2026-03-02', -300)] }), account({ accountId: 'B', rows: [start, row('2026-03-02', 300)] })],
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
      [account({ rows: [row(null, 1_000)] }), account({ accountId: 'W', trackingType: TrackingType.NOT_TRACKED, rows: [row('2026-03-01', -400)] })],
      '2026-03-01',
      '2026-03-01',
    );
    expect(out.accounts.map((a) => a.accountId)).toEqual(['A']);
    expect(out.totalCents).toEqual([1_000]);
  });

  it('fenêtre d’un jour ; sans compte, total à 0', () => {
    expect(balanceSeries([account({ rows: [row('2026-03-01', 42)] })], '2026-03-01', '2026-03-01').totalCents).toEqual([42]);
    expect(balanceSeries([], '2026-03-01', '2026-03-01')).toEqual({ dates: ['2026-03-01'], accounts: [], totalCents: [0] });
  });
});
