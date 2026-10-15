import { FeedbackType } from '../enums';

// Retours utilisateurs (SPEC §13.5). Texte brut, jamais interprété comme HTML.

/** NEW tant que l'administrateur ne l'a pas traité ; dérivé de `treatedAt`. */
export type FeedbackStatus = 'NEW' | 'TREATED';

/** Limites par utilisateur : 429 au-delà de `perDay` retours sur 24 h glissantes ou de `maxUntreated` non traités. */
export const FEEDBACK_LIMITS = { maxMessageLength: 2000, perDay: 5, maxUntreated: 20 } as const;

/** Purge : 30 j après le traitement, 90 j après la création si jamais traité ; alerte admin `warnDays` avant. */
export const FEEDBACK_RETENTION = { afterTreatedDays: 30, untreatedDays: 90, warnDays: 7 } as const;

/** POST /feedback. */
export interface CreateFeedbackInput {
  type: FeedbackType;
  message: string;
}

/** GET /feedback : les retours de l'utilisateur, du plus récent au plus ancien. */
export interface FeedbackDto {
  id: string;
  type: FeedbackType;
  message: string;
  status: FeedbackStatus;
  /** Horodatages ISO 8601 UTC. */
  createdAt: string;
  treatedAt: string | null;
}

/** GET /admin/feedback?type&status&sort=date|type|status ; POST /admin/feedback/:id/treat. Ni auteur ni e-mail. */
export interface AdminFeedbackDto extends FeedbackDto {
  /** Date de suppression automatique (ISO 8601 UTC). */
  expiresAt: string;
  /** Non traité et supprimé dans moins de `FEEDBACK_RETENTION.warnDays` jours. */
  expiringSoon: boolean;
}

export type AdminFeedbackSort = 'date' | 'type' | 'status';
