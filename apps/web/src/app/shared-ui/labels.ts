import { CategoryDto, IntervalUnit, TrackingType } from '@budgetracker/shared';

// Libellés UI des enums du domaine ; le Record impose un libellé pour chaque valeur.
export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  [TrackingType.NORMAL]: 'Normal',
  [TrackingType.NOT_TRACKED]: 'Non suivi (portefeuille)',
  [TrackingType.WITH_INTEREST]: 'Avec intérêts',
};

// « tous les N … »
export const UNIT_LABELS: Record<IntervalUnit, string> = {
  [IntervalUnit.DAY]: 'jour(s)',
  [IntervalUnit.WEEK]: 'semaine(s)',
  [IntervalUnit.MONTH]: 'mois',
  [IntervalUnit.YEAR]: 'an(s)',
};

// Catégories système (nameKey seedé par apps/api/prisma/seed.ts) ; les perso portent leur propre `name`.
export const CATEGORY_LABELS: Record<string, string> = {
  interest: 'Intérêts',
  cash: 'Espèces',
  opening_balance: 'Solde de départ',
  transfer: 'Virement',
  entertainment: 'Divertissement',
  'entertainment.video_games': 'Jeux vidéo',
  'entertainment.multimedia': 'Multimédia, cinéma, streaming',
  'entertainment.outings': 'Sorties',
  sport: 'Sport',
  'sport.subscription': 'Abonnement',
  'sport.license': 'Licence',
  'sport.session': 'Séance',
  'sport.equipment': 'Équipement',
  groceries: 'Courses',
  'groceries.food': 'Alimentaire',
  'groceries.clothing': 'Vêtements',
  'groceries.hygiene': 'Hygiène',
  housing: 'Logement',
  'housing.rent': 'Loyer',
  'housing.utilities': 'Charges',
  'housing.insurance': 'Assurance',
  transport: 'Transport',
  'transport.fuel': 'Carburant',
  'transport.public_transport': 'Transports en commun',
  'transport.maintenance': 'Entretien',
  health: 'Santé',
  'health.doctor': 'Médecin',
  'health.pharmacy': 'Pharmacie',
  income: 'Revenus',
  'income.salary': 'Salaire',
  'income.refund': 'Remboursement',
};

export const categoryLabel = (c: CategoryDto): string => c.name ?? CATEGORY_LABELS[c.nameKey ?? ''] ?? c.nameKey ?? '';

/** Libellé d'une transaction ou d'une ligne de stats sans catégorie. */
export const NO_CATEGORY_LABEL = 'Sans catégorie';

// Catégories techniques posées par le serveur (intérêts, virement vers portefeuille, solde de départ, virement) : jamais proposées à la saisie.
const TECHNICAL = new Set(['interest', 'cash', 'opening_balance', 'transfer']);

/** Choix d'une liste de saisie : racines (`parentId` null) ou sous-catégories de `parentId`, hors techniques, triés. */
export const categoryOptions = (all: CategoryDto[], parentId: string | null): { id: string; label: string }[] =>
  all
    .filter((c) => c.parentId === parentId && !TECHNICAL.has(c.nameKey ?? ''))
    .map((c) => ({ id: c.id, label: categoryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
