import { CategoryDto, TrackingType } from '@budgetracker/shared';

// Libellés UI des enums du domaine ; le Record impose un libellé pour chaque valeur.
export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  [TrackingType.NORMAL]: 'Normal',
  [TrackingType.NOT_TRACKED]: 'Non suivi (portefeuille)',
  [TrackingType.WITH_INTEREST]: 'Avec intérêts',
};

// Catégories système (nameKey seedé par apps/api/prisma/seed.ts) ; les perso portent leur propre `name`.
export const CATEGORY_LABELS: Record<string, string> = {
  interest: 'Intérêts',
  cash: 'Espèces',
  opening_balance: 'Solde de départ',
  transfer: 'Virement',
  entertainment: 'Divertissement',
  'entertainment.multimedia': 'Multimédia',
  'entertainment.outings': 'Sorties',
  sport: 'Sport',
  'sport.subscription': 'Abonnement',
  'sport.equipment': 'Équipement',
  groceries: 'Courses',
  'groceries.food': 'Alimentation',
  'groceries.hygiene': 'Hygiène',
  housing: 'Logement',
  'housing.rent': 'Loyer',
  'housing.utilities': 'Charges',
};

export const categoryLabel = (c: CategoryDto): string => c.name ?? CATEGORY_LABELS[c.nameKey ?? ''] ?? c.nameKey ?? '';
