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

// PATCH /recurrences/:id. Les occurrences déjà dues sont d'abord générées avec l'ancien modèle, puis :
// scope 'future' (défaut) ⇒ aucune transaction existante n'est réécrite ; 'all' ⇒ les champs envoyés du modèle
// sont aussi appliqués aux occurrences déjà créées et non supprimées (retouches individuelles écrasées). `version` périmée ⇒ 409.
export type RecurrenceUpdateScope = 'future' | 'all';
export const RECURRENCE_UPDATE_SCOPES: readonly RecurrenceUpdateScope[] = ['future', 'all'];

export interface UpdateRecurrenceInput {
  version: number;
  scope?: RecurrenceUpdateScope;
  endDate?: LocalDate | null;
  template?: Partial<TransactionTemplateInput>;
}
