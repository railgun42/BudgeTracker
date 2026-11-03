import type { LocalDate } from '../local-date';
import type { TransactionDto } from './transaction';

// Une opération, deux transactions jumelées par `transferId` : DEBIT sur la source, CREDIT sur la cible.
// `version` est le seul verrou des deux jambes. Exception : vers un compte NOT_TRACKED, seule la jambe
// DEBIT existe, en catégorie système « Espèces », sans jumelage (`id`, `version`, `credit` à null) :
// c'est une dépense ordinaire, modifiée ensuite via /transactions.
export interface TransferDto {
  id: string | null;
  version: number | null;
  debit: TransactionDto;
  credit: TransactionDto | null;
}

// POST /transfers. Source = cible ou source NOT_TRACKED ⇒ 422 ; compte d'un autre utilisateur ⇒ 404.
export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** Entier > 0. */
  amountCents: number;
  date: LocalDate;
  name?: string;
  details?: string | null;
  /** Obligatoire si `date` est le jour du solde de départ d'un des comptes ; vaut pour les deux jambes. */
  countInBalance?: boolean;
}

// PATCH /transfers/:id : appliqué aux deux jambes. `version` périmée ⇒ 409.
// Les jambes ne se modifient pas via PATCH /transactions (422) ; DELETE et restore
// d'une jambe via /transactions s'appliquent aux deux.
// `categoryId` (avec `subcategoryId` éventuelle, mêmes règles que PATCH /transactions) remplace la catégorie des
// deux jambes ; `categoryId: null` rétablit la catégorie système « Virement ». `tagIds` remplace les tags des deux jambes.
// Les comptes et le sens d'un virement ne changent pas.
export interface UpdateTransferInput {
  version: number;
  amountCents?: number;
  date?: LocalDate;
  name?: string;
  details?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  tagIds?: string[];
  countInBalance?: boolean;
}
