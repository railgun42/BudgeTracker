import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Role } from '@budgetracker/shared';
import { finalize } from 'rxjs';
import { Session } from './core/auth/session';
import { NotificationBell } from './features/notifications/notification-bell';

// Shell mobile-first : barre de navigation en bas sur mobile, dans l'en-tête dès 768px.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);
  protected readonly session = inject(Session);

  private readonly baseLinks = [
    { path: '/', label: 'Tableau de bord', exact: true },
    { path: '/accounts', label: 'Comptes', exact: false },
    { path: '/history', label: 'Historique', exact: false },
    { path: '/recurrences', label: 'Récurrences', exact: false },
    { path: '/categories', label: 'Catégories', exact: false },
    { path: '/stats', label: 'Statistiques', exact: false },
    { path: '/simulations', label: 'Simulations', exact: false },
    { path: '/me', label: 'Mon compte', exact: false },
    { path: '/feedback', label: 'Donner mon avis', exact: false },
  ];

  // Lien d'administration seulement pour un admin (SPEC §13.1).
  protected readonly links = computed(() =>
    this.session.user()?.role === Role.ADMIN ? [...this.baseLinks, { path: '/admin', label: 'Administration', exact: false }] : this.baseLinks,
  );

  protected logout(): void {
    // Même si l'API échoue, la session locale est vidée : on renvoie vers la connexion.
    this.session
      .logout()
      .pipe(finalize(() => this.router.navigateByUrl('/login')))
      .subscribe({ error: () => undefined });
  }
}
