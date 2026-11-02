import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NotificationDto } from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { errorMessage } from '../auth/auth-form';
import { NOTIFICATION_ICONS, notificationKindLabel, NOTIFICATION_READABLE, Notifications } from './notifications';

type Filter = 'ALL' | 'UNREAD';

// E40 (SPEC §13.6) : annonces et notifications personnelles, non lues d'abord. Texte brut (interpolation).
@Component({
  selector: 'app-notifications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <h1>Notifications</h1>
      @if (notifications.state().unreadCount > 0) {
        <button type="button" class="button button-secondary" [disabled]="marking() !== ''" (click)="markAll()">
          {{ marking() === 'ALL' ? 'Marquage en cours…' : 'Tout marquer comme lu' }}
        </button>
      }
    </div>

    @if (error() || notifications.error()) {
      <p class="alert alert-error" role="alert">{{ error() || notifications.error() }}</p>
    }
    <div aria-live="polite">
      @if (status()) {
        <p class="alert alert-success confirm-pop">{{ status() }}</p>
      }
    </div>

    <section class="card" aria-label="Liste des notifications">
      @if (notifications.loaded()) {
        @if (all().length) {
          <div class="segmented filter" role="group" aria-label="Filtrer les notifications">
            @for (f of filters; track f.value) {
              <button type="button" [attr.aria-pressed]="filter() === f.value" (click)="filter.set(f.value)">
                {{ f.label }} ({{ count(f.value) }})
              </button>
            }
          </div>
          @if (shown().length) {
            <ul class="rows" aria-label="Notifications">
              @for (n of shown(); track n.id) {
                <li class="row" [class.unread-row]="!n.read" [class.confirm-pop]="n.read && justRead().includes(n.id)">
                  <p class="row-head">
                    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[n.kind]" /></svg>
                    <strong>{{ kindLabel(n.kind) }}</strong><span class="visually-hidden"> · </span>
                    <time class="muted" [attr.datetime]="n.createdAt">{{ dateTime(n.createdAt) }}</time>
                    @if (!n.read) {
                      <span class="visually-hidden"> · </span><span class="unread-mark">Non lue</span>
                    }
                  </p>
                  <p class="message">{{ n.message }}</p>
                  @if (!n.read) {
                    <div class="row-actions">
                      <button type="button" class="button button-secondary" [disabled]="marking() !== ''" (click)="markRead(n)">
                        {{ marking() === n.id ? 'Marquage en cours…' : 'Marquer comme lue'
                        }}<span class="visually-hidden"> ({{ kindLabel(n.kind) }} du {{ dateTime(n.createdAt) }})</span>
                      </button>
                    </div>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="empty muted">Aucune notification non lue.</p>
          }
        } @else {
          <p class="empty muted">Aucune notification.</p>
        }
      } @else if (!notifications.error()) {
        <p class="muted" role="status">Chargement…</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
      max-width: 40rem;
    }
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    h1,
    .alert {
      margin: 0;
    }
    .filter {
      margin-bottom: var(--space-2);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .row {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-3) 0 var(--space-3) var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
      p {
        margin: 0;
      }
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      font-size: var(--text-sm);
    }
    .icon {
      flex: none;
      width: 1.25em;
      height: 1.25em;
      fill: none;
      stroke: var(--color-primary);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .unread-mark {
      margin-left: auto;
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .row-actions {
      margin-top: var(--space-1);
    }
    .empty {
      margin: 0;
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
  `,
})
export class NotificationsPage {
  protected readonly notifications = inject(Notifications);

  protected readonly kindLabel = notificationKindLabel;
  protected readonly icons = NOTIFICATION_ICONS;
  protected readonly dateTime = (iso: string) => NOTIFICATION_READABLE.format(new Date(iso));
  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'ALL', label: 'Toutes' },
    { value: 'UNREAD', label: 'Non lues' },
  ];
  protected readonly filter = signal<Filter>('ALL');
  protected readonly all = computed(() => this.notifications.state().items);
  protected readonly shown = computed(() => this.all().filter((n) => this.filter() === 'ALL' || !n.read));
  protected readonly count = (v: Filter) => this.all().filter((n) => v === 'ALL' || !n.read).length;
  /** Id en cours de marquage, 'ALL' pour « Tout marquer comme lu », '' sinon. */
  protected readonly marking = signal('');
  /** Ids qui viennent d'être marqués (confirm-pop). */
  protected readonly justRead = signal<string[]>([]);
  protected readonly error = signal('');
  protected readonly status = signal('');

  constructor() {
    this.notifications.refresh();
  }

  protected markRead(n: NotificationDto): void {
    this.marking.set(n.id);
    this.notifications.markRead(n.id).subscribe({
      next: () => this.done([n.id], 'Notification marquée comme lue.'),
      error: (e) => this.failed(e),
    });
  }

  // ponytail: un POST par non lue (au plus 200 éléments listés) ; endpoint groupé si ça devient lent.
  protected markAll(): void {
    const ids = this.all()
      .filter((n) => !n.read)
      .map((n) => n.id);
    this.marking.set('ALL');
    forkJoin(ids.map((id) => this.notifications.markRead(id))).subscribe({
      next: () => this.done(ids, 'Toutes les notifications sont marquées comme lues.'),
      error: (e) => {
        this.failed(e);
        this.notifications.refresh();
      },
    });
  }

  private done(ids: string[], message: string): void {
    this.marking.set('');
    this.justRead.set(ids);
    this.error.set('');
    this.status.set(message);
    this.notifications.refresh();
  }

  private failed(e: unknown): void {
    this.marking.set('');
    this.error.set(errorMessage(e, { 404: 'Cette notification n’existe plus.' }));
  }
}
