import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NotificationDto } from '@budgetracker/shared';
import { errorMessage } from '../auth/auth-form';
import { DATE_TIME } from '../feedback/feedback-page';
import { notificationKindLabel, Notifications } from './notifications';

// E40 (SPEC §13.6) : annonces et notifications personnelles, non lues d'abord. Texte brut (interpolation).
@Component({
  selector: 'app-notifications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Notifications</h1>

    @if (error() || notifications.error()) {
      <p class="alert alert-error" role="alert">{{ error() || notifications.error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <ul class="list" aria-label="Notifications">
      @for (n of notifications.state().items; track n.id) {
        <li class="card" [class.unread]="!n.read">
          <p>
            <strong>{{ kindLabel(n.kind) }}</strong> · {{ dateTime(n.createdAt) }}
            @if (!n.read) {
              · <strong>Non lue</strong>
            }
          </p>
          <p class="message">{{ n.message }}</p>
          @if (!n.read) {
            <button type="button" class="button button-secondary" (click)="markRead(n)">
              Marquer comme lue<span class="visually-hidden"> ({{ kindLabel(n.kind) }} du {{ dateTime(n.createdAt) }})</span>
            </button>
          }
        </li>
      } @empty {
        <li class="muted">Aucune notification.</li>
      }
    </ul>
  `,
  styles: `
    .list {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .card {
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }
    .unread {
      border-left: 4px solid var(--color-primary);
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class NotificationsPage {
  protected readonly notifications = inject(Notifications);

  protected readonly kindLabel = notificationKindLabel;
  protected readonly dateTime = (iso: string) => DATE_TIME.format(new Date(iso));
  protected readonly error = signal('');
  protected readonly status = signal('');

  constructor() {
    this.notifications.refresh();
  }

  protected markRead(n: NotificationDto): void {
    this.notifications.markRead(n.id).subscribe({
      next: () => {
        this.error.set('');
        this.status.set('Notification marquée comme lue.');
        this.notifications.refresh();
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette notification n’existe plus.' })),
    });
  }
}
