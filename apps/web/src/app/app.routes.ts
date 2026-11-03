import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core/auth/auth.guard';

const authed = { canActivate: [authGuard] };

export const routes: Routes = [
  {
    path: '',
    title: 'Tableau de bord',
    ...authed,
    loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  {
    path: 'accounts',
    title: 'Mes comptes',
    ...authed,
    loadComponent: () => import('./features/accounts/accounts-page').then((m) => m.AccountsPage),
  },
  {
    path: 'transactions/new',
    title: 'Ajouter une transaction',
    ...authed,
    loadComponent: () => import('./features/transactions/transaction-form-page').then((m) => m.TransactionFormPage),
  },
  {
    path: 'transfers/new',
    title: 'Nouveau virement',
    ...authed,
    loadComponent: () => import('./features/transactions/transfer-form-page').then((m) => m.TransferFormPage),
  },
  {
    path: 'history',
    title: 'Historique des transactions',
    ...authed,
    loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: 'recurrences',
    title: 'Récurrences',
    ...authed,
    loadComponent: () => import('./features/recurrences/recurrences-page').then((m) => m.RecurrencesPage),
  },
  {
    path: 'categories',
    title: 'Mes catégories',
    ...authed,
    loadComponent: () => import('./features/categories/categories-page').then((m) => m.CategoriesPage),
  },
  {
    path: 'stats',
    title: 'Statistiques',
    ...authed,
    loadComponent: () => import('./features/stats/stats-page').then((m) => m.StatsPage),
  },
  {
    path: 'simulations',
    title: 'Simulation de trésorerie',
    ...authed,
    loadComponent: () => import('./features/simulations/cashflow-page').then((m) => m.CashflowPage),
  },
  // Ancienne adresse (avant le retrait de la page des scénarios « et si »).
  { path: 'simulations/tresorerie', redirectTo: 'simulations' },
  {
    path: 'me',
    title: 'Mon compte',
    ...authed,
    loadComponent: () => import('./features/my-account/my-account-page').then((m) => m.MyAccountPage),
  },
  {
    path: 'me/coffre',
    title: 'Coffre-fort',
    ...authed,
    loadComponent: () => import('./features/my-account/vault-page').then((m) => m.VaultPage),
  },
  {
    path: 'feedback',
    title: 'Donner mon avis',
    ...authed,
    loadComponent: () => import('./features/feedback/feedback-page').then((m) => m.FeedbackPage),
  },
  {
    path: 'notifications',
    title: 'Notifications',
    ...authed,
    loadComponent: () => import('./features/notifications/notifications-page').then((m) => m.NotificationsPage),
  },
  {
    path: 'admin',
    title: 'Administration',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage),
  },
  {
    path: 'admin/categories',
    title: 'Catégories globales',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/categories/admin-categories-page').then((m) => m.AdminCategoriesPage),
  },
  {
    path: 'admin/feedback',
    title: 'Retours utilisateurs',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/feedback/admin-feedback-page').then((m) => m.AdminFeedbackPage),
  },
  {
    path: 'admin/notifications',
    title: 'Notifications et annonces',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/notifications/admin-notifications-page').then((m) => m.AdminNotificationsPage),
  },
  {
    path: 'admin/suggestions',
    title: 'Suggestions de catégorie',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/admin/suggestions/admin-suggestions-page').then((m) => m.AdminSuggestionsPage),
  },
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
    path: 'mentions-legales',
    title: 'Mentions légales',
    loadComponent: () => import('./features/legal/legal-pages').then((m) => m.LegalNoticePage),
  },
  {
    path: 'confidentialite',
    title: 'Politique de confidentialité',
    loadComponent: () => import('./features/legal/legal-pages').then((m) => m.PrivacyPage),
  },
  {
    path: 'cgu',
    title: 'Conditions générales d’utilisation',
    loadComponent: () => import('./features/legal/legal-pages').then((m) => m.TermsPage),
  },
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./shared-ui/not-found-page').then((m) => m.NotFoundPage),
  },
];
