import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '@budgetracker/shared';
import { Session } from './session';

// Écrans connectés : session restaurée par GET /me, sinon redirection vers la connexion avec retour prévu.
export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);
  if (!session.user()) await session.restore();
  return session.user() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Page d'administration : invisible pour un non-admin, renvoyé au tableau de bord. L'API vérifie le rôle de toute façon.
export const adminGuard: CanActivateFn = async () => {
  const session = inject(Session);
  if (!session.user()) await session.restore();
  return session.user()?.role === Role.ADMIN || inject(Router).createUrlTree(['/']);
};
