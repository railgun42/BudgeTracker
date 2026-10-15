import { inject, Injectable, signal } from '@angular/core';
import { NotificationKind, NotificationsDto } from '@budgetracker/shared';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';

export const notificationKindLabel = (kind: NotificationKind) => (kind === 'ANNOUNCEMENT' ? 'Annonce' : 'Message de l’administrateur');

// État partagé entre la cloche (pastille) et la page des notifications (SPEC §13.6).
@Injectable({ providedIn: 'root' })
export class Notifications {
  private readonly api = inject(ApiClient);

  readonly state = signal<NotificationsDto>({ unreadCount: 0, items: [] });
  readonly error = signal('');

  refresh(): void {
    this.api.get<NotificationsDto>('/notifications').subscribe({
      next: (state) => {
        this.state.set(state);
        this.error.set('');
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  markRead(id: string): Observable<void> {
    return this.api.post<void>(`/notifications/${id}/read`);
  }
}
