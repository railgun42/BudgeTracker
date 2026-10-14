import type { IntervalUnit, TransactionType } from '../enums';
import type { LocalDate } from '../local-date';

// Modèle lu à chaque génération : le modifier ne vaut que pour le futur (SPEC §3.6).
export interface TransactionTemplateDto {
  name: string;
  amountCents: number;
  type: TransactionType;
  /** Comme `TransactionDto.categoryId` : la plus précise, `null` = sans catégorie. */
  categoryId: string | null;
  details: string | null;
  tagIds: string[];
}

export interface RecurrenceDto {
  id: string;
  accountId: string;
  interval: number;
  unit: IntervalUnit;
  startDate: LocalDate;
  /** Inclusive. */
  endDate: LocalDate | null;
  template: TransactionTemplateDto;
  version: number;
}

// POST /recurrences. `type` : DEBIT par défaut. Les occurrences dues jusqu'à aujourd'hui sont
// créées aussitôt ; compte, catégorie ou tag d'un autre utilisateur ⇒ 404.
export interface CreateRecurrenceInput {
  accountId: string;
  /** Entier ≥ 1. */
  interval: number;
  unit: IntervalUnit;
  startDate: LocalDate;
  endDate?: LocalDate | null;
  template: TransactionTemplateInput;
}

// Catégorie et sous-catégorie facultatives, mêmes règles que CreateTransactionInput.
export interface TransactionTemplateInput {
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Entier > 0. */
  amountCents: number;
  type?: TransactionType;
  name?: string;
  details?: string | null;
  tagIds?: string[];
}

// PATCH /recurrences/:id. Futur seulement : les occurrences déjà dues sont d'abord générées avec
// l'ancien modèle, aucune transaction existante n'est réécrite. `version` périmée ⇒ 409.
export interface UpdateRecurrenceInput {
  version: number;
  endDate?: LocalDate | null;
  template?: Partial<TransactionTemplateInput>;
}
