import { previousRange } from '../../core/date-range';
import { dashboardRange } from './dashboard-period';

describe('dashboardRange', () => {
  it('mois actuel : mois entier, février compris', () => {
    expect(dashboardRange('THIS_MONTH', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(dashboardRange('THIS_MONTH', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('3, 6 et 12 mois finissent avec le mois courant, à cheval sur deux années si besoin', () => {
    expect(dashboardRange('LAST_3_MONTHS', '2026-11-03')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(dashboardRange('LAST_6_MONTHS', '2026-11-03')).toEqual({ from: '2026-06-01', to: '2026-11-30' });
    expect(dashboardRange('LAST_6_MONTHS', '2026-02-10')).toEqual({ from: '2025-09-01', to: '2026-02-28' });
    expect(dashboardRange('LAST_12_MONTHS', '2026-11-03')).toEqual({ from: '2025-12-01', to: '2026-11-30' });
  });

  it('la période précédente a la même durée en mois entiers', () => {
    const prev = (p: Parameters<typeof dashboardRange>[0]) => {
      const { from, to } = dashboardRange(p, '2026-03-10');
      return previousRange(from, to);
    };
    expect(prev('THIS_MONTH')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(prev('LAST_3_MONTHS')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(prev('LAST_6_MONTHS')).toEqual({ from: '2025-04-01', to: '2025-09-30' });
  });
});
