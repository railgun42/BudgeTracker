export interface CategoryDto {
  id: string;
  parentId: string | null;
  /** true : catégorie système, non modifiable, libellé à traduire via `nameKey`. */
  system: boolean;
  nameKey: string | null;
  /** Libellé d'une catégorie personnelle. */
  name: string | null;
  color: string | null;
}

// POST /categories. `parentId` : catégorie racine (système ou perso) ; 2 niveaux max ⇒ sinon 422.
export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  /** '#RRGGBB'. */
  color?: string | null;
}

// PATCH /categories/:id (perso uniquement, système ⇒ 403). `parentId: null` ⇒ devient racine.
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

// DELETE /categories/:id?reassignTo=<id>. Catégorie utilisée sans cible ⇒ 409 ;
// avec cible, ses transactions et modèles de récurrence y sont réaffectés avant suppression.
export interface DeleteCategoryQuery {
  reassignTo?: string;
}

export interface TagDto {
  id: string;
  name: string;
}

// POST /tags, PATCH /tags/:id. Nom unique par utilisateur, sans tenir compte de la casse ⇒ sinon 409.
export interface TagInput {
  name: string;
}
