// Notifications (cloche) et annonces (SPEC §13.6). Texte brut, jamais interprété comme HTML.

export const NOTIFICATION_MAX_LENGTH = 2000;

/** Préavis proposé par défaut avant l'entrée en vigueur de nouvelles CGU (SPEC §13.6). */
export const TERMS_NOTICE_DAYS = 30;

/** ANNOUNCEMENT : annonce à tous ; PERSONAL : notification adressée à l'utilisateur seul. */
export type NotificationKind = 'ANNOUNCEMENT' | 'PERSONAL';

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  message: string;
  /** Horodatage ISO 8601 UTC. */
  createdAt: string;
  read: boolean;
}

/** GET /notifications : non lues d'abord, puis les plus récentes ; `unreadCount` alimente la pastille de la cloche. */
export interface NotificationsDto {
  unreadCount: number;
  items: NotificationDto[];
}

/** POST /admin/announcements. */
export interface CreateAnnouncementInput {
  message: string;
}

/** POST /admin/notifications : destinataire désigné par son e-mail. */
export interface CreateNotificationInput {
  email: string;
  message: string;
}

/** Réponse des deux envois admin : ni destinataire ni e-mail. */
export interface SentMessageDto {
  id: string;
  message: string;
  createdAt: string;
}
