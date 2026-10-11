import { TrackingType } from '@budgetracker/shared';
import { TRACKING_TYPE_LABELS } from './labels';

// Valide aussi R1 côté Angular : l'enum de @budgetracker/shared se résout et se bundle.
describe('TRACKING_TYPE_LABELS', () => {
  it('a un libellé pour chaque TrackingType du package shared', () => {
    expect(Object.keys(TRACKING_TYPE_LABELS).sort()).toEqual(Object.values(TrackingType).sort());
    expect(TRACKING_TYPE_LABELS[TrackingType.NOT_TRACKED]).toBe('Non suivi (portefeuille)');
  });
});
