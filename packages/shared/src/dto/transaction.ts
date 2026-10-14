import type { TransactionType } from '../enums';
import type { LocalDate } from '../local-date';

export interface AttachmentDto {
  id: string;
  /** Affichage seulement. */
  originalName: string;
  mime: string;
  sizeBytes: number;
}

// POST /transactions/:id/attachment (multipart, champ `file`). Type détecté par signature côté serveur :
// hors liste ⇒ 415 ; > 5 Mo ⇒ 413 ; quota dépassé ⇒ 422 ; pièce déjà présente ⇒ 409.
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** GET /transactions/:id/attachment : URL signée de courte durée. */
export interface AttachmentUrlDto {
  url: string;
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
  /** La plus précise des deux (sous-catégorie, sinon catégorie) ; `null` = sans catégorie. */
  categoryId: string | null;
  tagIds: string[];
  /** Non nul pour une jambe de virement. */
  transferId: string | null;
  recurrenceId: string | null;
  /** Choix fait le jour du solde de départ ; `null` = pas de choix (comptée). */
  countInBalance: boolean | null;
  attachment: AttachmentDto | null;
  version: number;
}

// POST /transactions. Saisie en 3 champs (montant, catégorie, compte) ; la date (aujourd'hui
// par défaut) est fournie par le client et validée par le serveur. `type` : DEBIT par défaut.
// Catégorie et sous-catégorie facultatives : la sous-catégorie doit être un enfant de `categoryId` (sinon 422).
// Compte, catégorie ou tag d'un autre utilisateur ⇒ 404 ; CREDIT sur un compte NOT_TRACKED ⇒ 422.
// Datée du jour du solde de départ du compte (`AccountDto.openingDate`) : `countInBalance` obligatoire (400).
export interface CreateTransactionInput {
  accountId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Entier > 0. */
  amountCents: number;
  date: LocalDate;
  type?: TransactionType;
  name?: string;
  details?: string | null;
  tagIds?: string[];
  /** Compter dans le solde une transaction du jour du solde de départ (sinon déjà comprise dedans). */
  countInBalance?: boolean;
}

// PATCH /transactions/:id. `version` périmée ⇒ 409 ; `tagIds` remplace l'ensemble des tags.
// `categoryId` (avec `subcategoryId` éventuelle) remplace la catégorie ; `categoryId: null` l'efface.
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
  /** Exacte (sous-catégories exclues) ; `UNCATEGORIZED` ⇒ transactions sans catégorie. */
  categoryId?: string;
  tagId?: string;
}

export interface TransactionPage {
  items: TransactionDto[];
  /** Absent sur la dernière page. */
  nextCursor: string | null;
}
