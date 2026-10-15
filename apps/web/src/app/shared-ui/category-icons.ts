import { CategoryDto } from '@budgetracker/shared';

// Tracés SVG 24×24 au trait (classe .category-icon de la charte), par nameKey de catégorie racine seedée.
const CATEGORY_ICONS: Record<string, string> = {
  entertainment: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM10 8.5v7l5.5-3.5z',
  sport: 'M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11',
  groceries: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  housing: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  transport: 'M4 16v-4l2-5h12l2 5v4zM4 12h16M7 16v2.5M17 16v2.5',
  health: 'M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z',
  income: 'M12 4v10M7.5 9.5L12 14l4.5-4.5M4 15v4h16v-4',
  // Techniques (posées par le serveur) : visibles dans l'historique seulement.
  transfer: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  interest: 'M18 6L6 18M7.5 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM16.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z',
  opening_balance: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
};
/** Catégorie perso ou créée par l'admin (sans nameKey). */
const TAG_ICON = 'M3.5 12.5V4h8.5l8.5 8.5-8 8zM8 8.5h.01';
/** Transaction sans catégorie. */
export const NO_CATEGORY_ICON = 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 12h8';

/** Icône d'une catégorie racine (une sous-catégorie prend celle de son parent, voir l'appelant). */
export const categoryIcon = (c: CategoryDto): string => CATEGORY_ICONS[c.nameKey ?? ''] ?? TAG_ICON;
