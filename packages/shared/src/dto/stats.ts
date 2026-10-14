import type { LocalDate } from '../local-date';

// GET /stats/{by-category,by-tag,monthly}. `from`/`to` inclusifs ; `accountId` absent ⇒ tous les comptes.
// Périmètre : transactions non supprimées de comptes non supprimés, hors jambes de virement et hors
// « Solde de départ ». Le virement vers un portefeuille (catégorie « Espèces ») est une dépense ;
// un compte NOT_TRACKED ne compte que des dépenses. Compte d'un autre utilisateur ⇒ 404.
export interface StatsQuery {
  from?: LocalDate;
  to?: LocalDate;
  accountId?: string;
}

/** Totaux en centimes (≥ 0) : revenus = CREDIT, dépenses = DEBIT. */
export interface StatTotals {
  incomeCents: number;
  expenseCents: number;
}

/** Par catégorie exacte (enfant ou racine), dépenses décroissantes ; une seule ligne `null` = « Sans catégorie ». */
export interface CategoryStatDto extends StatTotals {
  categoryId: string | null;
}

/** Par tag : une transaction à plusieurs tags compte pour chacun ; sans tag ⇒ absente. */
export interface TagStatDto extends StatTotals {
  tagId: string;
}

/** Mois sans transaction absents ; ordre chronologique. */
export interface MonthlyStatDto extends StatTotals {
  /** 'YYYY-MM'. */
  month: string;
}
