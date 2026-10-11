import type { IntervalUnit, TransactionType } from '../enums';
import type { LocalDate } from '../local-date';

// Modèle lu à chaque génération : le modifier ne vaut que pour le futur (SPEC §3.6).
export interface TransactionTemplateDto {
  name: string;
  amountCents: number;
  type: TransactionType;
  categoryId: string;
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
