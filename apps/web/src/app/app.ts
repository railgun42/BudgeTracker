import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Role } from '@budgetracker/shared';
import { filter, finalize } from 'rxjs';
import { Session } from './core/auth/session';
import { NotificationBell } from './features/notifications/notification-bell';

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'theme';

// Préférence d'affichage seulement (aucune donnée métier) ; stockage indisponible ⇒ « auto ».
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

// Shell mobile-first : menu hamburger (popover) sur mobile, barre latérale dès 768px ; menu du compte (popover).
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  protected readonly session = inject(Session);

  private readonly baseLinks = [
    { path: '/', label: 'Tableau de bord', exact: true },
    { path: '/accounts', label: 'Comptes', exact: false },
    { path: '/history', label: 'Historique', exact: false },
    { path: '/recurrences', label: 'Récurrences', exact: false },
    { path: '/categories', label: 'Catégories', exact: false },
    { path: '/stats', label: 'Statistiques', exact: false },
    { path: '/simulations', label: 'Simulations', exact: false },
  ];

  // Lien d'administration seulement pour un admin (SPEC §13.1).
  protected readonly links = computed(() =>
    this.session.user()?.role === Role.ADMIN ? [...this.baseLinks, { path: '/admin', label: 'Administration', exact: false }] : this.baseLinks,
  );

  protected readonly initials = computed(() => {
    const user = this.session.user();
    const words = (user?.name || user?.email || '?').trim().split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  });

  protected readonly themes = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Clair' },
    { value: 'dark', label: 'Sombre' },
  ] as const;
  protected readonly theme = signal<Theme>(readTheme());

  private readonly openPopovers = new Set<HTMLElement>();

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = this.document.documentElement;
      if (theme === 'auto') delete root.dataset['theme'];
      else root.dataset['theme'] = theme;
      try {
        if (theme === 'auto') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Stockage bloqué : le choix vaut pour la session en cours.
      }
    });

    // Un lien suivi dans un menu ouvert le referme.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.openPopovers.forEach((el) => el.hidePopover()));
  }

  protected onPopoverToggle(event: Event): void {
    const el = event.target as HTMLElement;
    if ((event as ToggleEvent).newState === 'open') this.openPopovers.add(el);
    else this.openPopovers.delete(el);
  }

  protected logout(): void {
    // Même si l'API échoue, la session locale est vidée : on renvoie vers la connexion.
    this.session
      .logout()
      .pipe(finalize(() => this.router.navigateByUrl('/login')))
      .subscribe({ error: () => undefined });
  }
}
