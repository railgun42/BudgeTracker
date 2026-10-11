import type { TransactionType } from '../enums';
import type { LocalDate } from '../local-date';

export interface AttachmentDto {
  id: string;
  /** Affichage seulement. */
  originalName: string;
  mime: string;
  sizeBytes: number;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  name: string;
  date: LocalDate;
  /** Toujours > 0 ; le sens est porté par `type`. */
  amountCents: number;
  type: TransactionType;
  details: string | null;
  categoryId: string;
  tagIds: string[];
  /** Non nul pour une jambe de virement. */
  transferId: string | null;
  recurrenceId: string | null;
  attachment: AttachmentDto | null;
  version: number;
}

// POST /transactions. Saisie en 3 champs (montant, catégorie, compte) ; la date (aujourd'hui
// par défaut) est fournie par le client et validée par le serveur. `type` : DEBIT par défaut.
// Compte, catégorie ou tag d'un autre utilisateur ⇒ 404 ; CREDIT sur un compte NOT_TRACKED ⇒ 422.
export interface CreateTransactionInput {
  accountId: string;
  categoryId: string;
  /** Entier > 0. */
  amountCents: number;
  date: LocalDate;
  type?: TransactionType;
  name?: string;
  details?: string | null;
  tagIds?: string[];
}

// PATCH /transactions/:id. `version` périmée ⇒ 409 ; `tagIds` remplace l'ensemble des tags.
export interface UpdateTransactionInput extends Partial<CreateTransactionInput> {
  version: number;
}

// GET /transactions. Tri (date, id) décroissant ; `from`/`to` inclusifs.
export interface TransactionListQuery {
  cursor?: string;
  /** 1–100, 50 par défaut. */
  limit?: number;
  from?: LocalDate;
  to?: LocalDate;
  accountId?: string;
  categoryId?: string;
  tagId?: string;
}

export interface TransactionPage {
  items: TransactionDto[];
  /** Absent sur la dernière page. */
  nextCursor: string | null;
}
