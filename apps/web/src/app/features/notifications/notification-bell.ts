import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { NOTIFICATION_ICONS, notificationKindLabel, NOTIFICATION_READABLE, Notifications } from './notifications';

const PREVIEW = 5;

// Cloche de la barre de navigation (SPEC §7, §13.6) : pastille = nombre de non lues, relu à chaque navigation.
// Un clic ouvre un panneau (popover) avec les dernières notifications et un lien vers la page complète.
// ponytail: pas de polling ; une annonce apparaît à la navigation suivante, ajouter un intervalle si besoin.
@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="bell" popovertarget="notifications-panel" [attr.aria-label]="label()">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      @if (count() > 0) {
        <span class="badge" aria-hidden="true">{{ count() > 99 ? '99+' : count() }}</span>
      }
    </button>

    <div #panel id="notifications-panel" class="menu panel" popover aria-labelledby="notifications-panel-title">
      <p class="panel-head">
        <strong id="notifications-panel-title">Notifications</strong><span class="visually-hidden"> · </span>
        <span class="muted">{{ count() === 0 ? 'Tout est lu' : count() + ' non lue' + (count() > 1 ? 's' : '') }}</span>
      </p>
      @if (notifications.error()) {
        <p class="alert alert-error" role="alert">{{ notifications.error() }}</p>
      } @else if (!notifications.loaded()) {
        <p class="muted" role="status">Chargement…</p>
      } @else if (latest().length) {
        <ul class="rows" aria-label="Dernières notifications">
          @for (n of latest(); track n.id) {
            <li class="row" [class.unread-row]="!n.read">
              <p class="row-head">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[n.kind]" /></svg>
                <strong>{{ kindLabel(n.kind) }}</strong><span class="visually-hidden"> · </span>
                <time class="muted" [attr.datetime]="n.createdAt">{{ dateTime(n.createdAt) }}</time>
                @if (!n.read) {
                  <span class="visually-hidden"> · </span><span class="unread-mark">Non lue</span>
                }
              </p>
              <p class="message">{{ n.message }}</p>
            </li>
          }
        </ul>
      } @else {
        <p class="empty muted">Aucune notification.</p>
      }
      <div class="panel-actions">
        <a routerLink="/notifications" class="button button-secondary" (click)="panel.hidePopover()">Voir toutes les notifications</a>
      </div>
    </div>
  `,
  styles: `
    .bell {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: var(--tap);
      height: var(--tap);
      padding: 0;
      border: 0;
      border-radius: var(--radius);
      background: none;
      color: var(--color-text);
      cursor: pointer;
      &:hover {
        background: var(--color-surface-2);
      }
      svg {
        width: var(--text-xl);
        height: var(--text-xl);
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }
    .badge {
      position: absolute;
      top: var(--space-1);
      right: 0;
      box-shadow: 0 0 0 2px var(--color-surface);
    }
    .panel {
      inset: calc(var(--header-height) + var(--space-1)) var(--space-3) auto auto;
      width: min(24rem, calc(100vw - 2 * var(--space-3)));
      max-height: calc(100dvh - var(--header-height) - var(--space-4));
      overflow-y: auto;
      &:popover-open {
        gap: var(--space-2);
      }
      p {
        margin: 0;
      }
    }
    .panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-1) var(--space-2);
      padding: var(--space-1) var(--space-2);
      .muted {
        font-size: var(--text-sm);
      }
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      border-block: 1px solid var(--color-border);
    }
    .row {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
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
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .empty {
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    .panel-actions .button {
      width: 100%;
    }
  `,
})
export class NotificationBell {
  protected readonly notifications = inject(Notifications);

  protected readonly kindLabel = notificationKindLabel;
  protected readonly icons = NOTIFICATION_ICONS;
  protected readonly dateTime = (iso: string) => NOTIFICATION_READABLE.format(new Date(iso));
  protected readonly count = computed(() => this.notifications.state().unreadCount);
  // Les items arrivent non lues d'abord, puis les plus récentes.
  protected readonly latest = computed(() => this.notifications.state().items.slice(0, PREVIEW));
  protected readonly label = computed(() => {
    const n = this.count();
    return n === 0 ? 'Notifications' : `Notifications (${n} non lue${n > 1 ? 's' : ''})`;
  });

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.notifications.refresh());
    this.notifications.refresh();
  }
}
