import { previousRange } from '../../core/date-range';
import { dashboardRange } from './dashboard-period';

describe('dashboardRange', () => {
  it('ce mois-ci et mois dernier : mois entiers, février compris', () => {
    expect(dashboardRange('THIS_MONTH', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(dashboardRange('LAST_MONTH', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(dashboardRange('LAST_MONTH', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('30 jours finissant aujourd’hui, 3 et 12 mois finissant en fin de mois courant', () => {
    expect(dashboardRange('LAST_30_DAYS', '2026-03-10')).toEqual({ from: '2026-02-09', to: '2026-03-10' });
    expect(dashboardRange('LAST_3_MONTHS', '2026-11-03')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(dashboardRange('LAST_12_MONTHS', '2026-11-03')).toEqual({ from: '2025-12-01', to: '2026-11-30' });
  });

  it('la période précédente a la même durée (mois entiers ou jours)', () => {
    const prev = (p: Parameters<typeof dashboardRange>[0]) => {
      const { from, to } = dashboardRange(p, '2026-03-10');
      return previousRange(from, to);
    };
    expect(prev('THIS_MONTH')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(prev('LAST_3_MONTHS')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(prev('LAST_30_DAYS')).toEqual({ from: '2026-01-10', to: '2026-02-08' });
  });
});
