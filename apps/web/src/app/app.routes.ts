import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

// Écrans issus de docs/wireframes ; chaque étape E15+ remplace son placeholder par la vraie page.
const placeholder = () => import('./shared-ui/placeholder-page').then((m) => m.PlaceholderPage);
const authed = { canActivate: [authGuard] };

export const routes: Routes = [
  { path: '', title: 'Tableau de bord', ...authed, loadComponent: placeholder },
  { path: 'accounts', title: 'Mes comptes', ...authed, loadComponent: placeholder },
  { path: 'transactions/new', title: 'Ajouter une transaction', ...authed, loadComponent: placeholder },
  { path: 'history', title: 'Historique des transactions', ...authed, loadComponent: placeholder },
  { path: 'stats', title: 'Statistiques', ...authed, loadComponent: placeholder },
  { path: 'simulations', title: 'Simulations', ...authed, loadComponent: placeholder },
  {
    path: 'login',
    title: 'Connexion',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    title: 'Créer un compte',
    loadComponent: () => import('./features/auth/signup-page').then((m) => m.SignupPage),
  },
  {
    path: 'verify-email',
    title: "Vérification de l'adresse e-mail",
    loadComponent: () => import('./features/auth/verify-email-page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'forgot-password',
    title: 'Mot de passe oublié',
    loadComponent: () => import('./features/auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: 'Nouveau mot de passe',
    loadComponent: () => import('./features/auth/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./shared-ui/not-found-page').then((m) => m.NotFoundPage),
  },
];
