export interface CategoryDto {
  id: string;
  parentId: string | null;
  /** true : catégorie système, non modifiable, libellé à traduire via `nameKey`. */
  system: boolean;
  nameKey: string | null;
  /** Libellé d'une catégorie personnelle. */
  name: string | null;
  color: string | null;
  /** Préférence de l'utilisateur sur une catégorie système : exclue des listes de saisie (reste affichée sur les transactions). */
  hidden: boolean;
  /** Renommage d'une catégorie système pour cet utilisateur seul ; prioritaire sur `nameKey`. */
  customName: string | null;
  /** Catégorie globale archivée par l'administrateur : exclue des listes de saisie, reste affichée sur les transactions. */
  archived: boolean;
}

/** Catégories système posées par le code (intérêts, retrait d'espèces, solde de départ, virement) : jamais proposées à la saisie ni modifiables par l'administrateur. */
export const TECHNICAL_CATEGORY_KEYS: readonly string[] = ['interest', 'cash', 'opening_balance', 'transfer'];

/** Valeur du filtre `categoryId` de GET /transactions : transactions sans catégorie. */
export const UNCATEGORIZED = 'none';

// POST /categories. `parentId` : catégorie racine (système ou perso) ; 2 niveaux max ⇒ sinon 422.
export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  /** '#RRGGBB'. */
  color?: string | null;
  /** POST /categories seulement : « proposer cette catégorie à tous » (parent global ou aucun, sinon 422). */
  suggest?: boolean;
}

// PATCH /categories/:id (perso uniquement, système ⇒ 403). `parentId: null` ⇒ devient racine.
export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, 'suggest'>>;

// DELETE /categories/:id?reassignTo=<id>. Catégorie utilisée sans cible ⇒ 409 ;
// avec cible, ses transactions et modèles de récurrence y sont réaffectés avant suppression.
export interface DeleteCategoryQuery {
  reassignTo?: string;
}

// PUT /categories/:id/preference (catégorie système uniquement, perso ⇒ 422 : la modifier directement).
// `customName: null` ⇒ nom d'origine. Ne touche ni aux autres utilisateurs ni aux transactions.
export interface CategoryPreferenceInput {
  hidden: boolean;
  customName?: string | null;
}

export interface TagDto {
  id: string;
  name: string;
}

// POST /tags, PATCH /tags/:id. Nom unique par utilisateur, sans tenir compte de la casse ⇒ sinon 409.
export interface TagInput {
  name: string;
}

// Suggestions de catégorie globale (SPEC §13.5). Texte brut, jamais interprété comme HTML.

/** PENDING tant que l'administrateur ne l'a pas acceptée (globale créée), refusée ou simplement traitée. */
export type CategorySuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'TREATED';
export type CategorySuggestionDecision = Exclude<CategorySuggestionStatus, 'PENDING'>;

/** 429 au-delà de ce nombre de suggestions en attente par utilisateur. */
export const CATEGORY_SUGGESTION_MAX_PENDING = 20;

/** GET /categories/suggestions (les siennes) et GET /admin/category-suggestions?status (toutes, sans auteur). */
export interface CategorySuggestionDto {
  id: string;
  name: string;
  /** Catégorie globale sous laquelle la proposer ; null = catégorie principale. */
  parentId: string | null;
  status: CategorySuggestionStatus;
  /** Horodatages ISO 8601 UTC. */
  createdAt: string;
  treatedAt: string | null;
}

/**
 * POST /admin/category-suggestions/:id/resolve. ACCEPTED rend globale la catégorie perso de l'auteur (globale neuve s'il
 * l'a supprimée), masquée par défaut pour les utilisateurs déjà inscrits ; doublon ⇒ 409, rien n'est changé.
 * `reply` : notification personnelle à l'auteur (facultative). Suggestion déjà traitée ⇒ 409.
 */
export interface ResolveCategorySuggestionInput {
  decision: CategorySuggestionDecision;
  reply?: string;
}
