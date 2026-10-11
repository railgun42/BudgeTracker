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

export interface TagDto {
  id: string;
  name: string;
}
