import { TrackingType } from '@budgetracker/shared';

// Libellés UI des enums du domaine ; le Record impose un libellé pour chaque valeur.
export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  [TrackingType.NORMAL]: 'Normal',
  [TrackingType.NOT_TRACKED]: 'Non suivi (portefeuille)',
  [TrackingType.WITH_INTEREST]: 'Avec intérêts',
};
