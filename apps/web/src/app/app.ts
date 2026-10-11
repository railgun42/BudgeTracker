import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Shell mobile-first : barre de navigation en bas sur mobile, dans l'en-tête dès 768px.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly links = [
    { path: '/', label: 'Tableau de bord', exact: true },
    { path: '/accounts', label: 'Comptes', exact: false },
    { path: '/history', label: 'Historique', exact: false },
    { path: '/stats', label: 'Statistiques', exact: false },
    { path: '/simulations', label: 'Simulations', exact: false },
  ];
}
