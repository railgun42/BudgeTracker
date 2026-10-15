import { CategoryDto, IntervalUnit, TECHNICAL_CATEGORY_KEYS, TrackingType } from '@budgetracker/shared';

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

// Catégories système (nameKey seedé par apps/api/prisma/seed.ts) ; les perso et les globales créées par l'admin portent leur `name`
// (un `name` posé par l'admin sur une catégorie seedée remplace sa traduction).
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

/** Nom choisi par l'utilisateur pour une catégorie système, sinon nom perso, sinon libellé traduit. */
export const categoryLabel = (c: CategoryDto): string => c.customName ?? c.name ?? CATEGORY_LABELS[c.nameKey ?? ''] ?? c.nameKey ?? '';

/** Libellé d'une transaction ou d'une ligne de stats sans catégorie. */
export const NO_CATEGORY_LABEL = 'Sans catégorie';

// Catégories techniques posées par le serveur (intérêts, virement vers portefeuille, solde de départ, virement) : jamais proposées à la saisie.
export const isTechnical = (c: CategoryDto): boolean => TECHNICAL_CATEGORY_KEYS.includes(c.nameKey ?? '');

/** Choix d'une liste de saisie : racines (`parentId` null) ou sous-catégories de `parentId`, hors techniques, masquées et archivées, triés. */
export const categoryOptions = (all: CategoryDto[], parentId: string | null): { id: string; label: string }[] =>
  all
    .filter((c) => c.parentId === parentId && !isTechnical(c) && !c.hidden && !c.archived)
    .map((c) => ({ id: c.id, label: categoryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
