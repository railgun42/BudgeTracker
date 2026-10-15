import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { Notifications } from './notifications';

// Cloche de la barre de navigation (SPEC §7, §13.6) : pastille = nombre de non lues, relu à chaque navigation.
// ponytail: pas de polling ; une annonce apparaît à la navigation suivante, ajouter un intervalle si besoin.
@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/notifications" class="bell" [attr.aria-label]="label()">
      <span aria-hidden="true">🔔</span>
      @if (count() > 0) {
        <span class="badge" aria-hidden="true">{{ count() > 99 ? '99+' : count() }}</span>
      }
    </a>
  `,
  styles: `
    .bell {
      position: relative;
      display: inline-flex;
      padding: var(--space-1);
      font-size: 1.25rem;
      text-decoration: none;
    }
    .badge {
      position: absolute;
      top: -0.25rem;
      right: -0.5rem;
      min-width: 1.25rem;
      padding: 0 0.25rem;
      border-radius: 1rem;
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-size: 0.75rem;
      font-weight: 700;
      line-height: 1.25rem;
      text-align: center;
    }
  `,
})
export class NotificationBell {
  private readonly notifications = inject(Notifications);

  protected readonly count = computed(() => this.notifications.state().unreadCount);
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
