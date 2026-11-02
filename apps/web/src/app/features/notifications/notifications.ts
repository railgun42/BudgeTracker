import { inject, Injectable, signal } from '@angular/core';
import { NotificationKind, NotificationsDto } from '@budgetracker/shared';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';

export const notificationKindLabel = (kind: NotificationKind) => (kind === 'ANNOUNCEMENT' ? 'Annonce' : 'Message de l’administrateur');
// Affichage seulement : « 15 oct. 2026, 10:00 » dans le fuseau du navigateur.
export const NOTIFICATION_READABLE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
// Icônes décoratives au trait (viewBox 24) : mégaphone pour une annonce, enveloppe pour un message personnel.
export const NOTIFICATION_ICONS: Record<NotificationKind, string> = {
  ANNOUNCEMENT: 'M3 10v4h4l6 4V6L7 10H3zM16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13',
  PERSONAL: 'M3 6h18v12H3zM3 7l9 6 9-6',
};

// État partagé entre la cloche (pastille) et la page des notifications (SPEC §13.6).
@Injectable({ providedIn: 'root' })
export class Notifications {
  private readonly api = inject(ApiClient);

  readonly state = signal<NotificationsDto>({ unreadCount: 0, items: [] });
  readonly error = signal('');
  /** Faux jusqu'à la première réponse (« Chargement… »). */
  readonly loaded = signal(false);

  refresh(): void {
    this.api.get<NotificationsDto>('/notifications').subscribe({
      next: (state) => {
        this.state.set(state);
        this.loaded.set(true);
        this.error.set('');
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  markRead(id: string): Observable<void> {
    return this.api.post<void>(`/notifications/${id}/read`);
  }
}
