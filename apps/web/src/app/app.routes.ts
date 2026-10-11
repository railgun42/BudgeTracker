import { Routes } from '@angular/router';

// Écrans issus de docs/wireframes ; chaque étape E15+ remplace son placeholder par la vraie page.
const placeholder = () => import('./shared-ui/placeholder-page').then((m) => m.PlaceholderPage);

export const routes: Routes = [
  { path: '', title: 'Tableau de bord', loadComponent: placeholder },
  { path: 'accounts', title: 'Mes comptes', loadComponent: placeholder },
  { path: 'transactions/new', title: 'Ajouter une transaction', loadComponent: placeholder },
  { path: 'history', title: 'Historique des transactions', loadComponent: placeholder },
  { path: 'stats', title: 'Statistiques', loadComponent: placeholder },
  { path: 'simulations', title: 'Simulations', loadComponent: placeholder },
  { path: 'login', title: 'Connexion', loadComponent: placeholder },
  { path: 'signup', title: 'Créer un compte', loadComponent: placeholder },
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./shared-ui/not-found-page').then((m) => m.NotFoundPage),
  },
];
