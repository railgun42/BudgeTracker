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
