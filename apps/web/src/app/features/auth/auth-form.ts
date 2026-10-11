import { HttpErrorResponse } from '@angular/common/http';
import { Validators } from '@angular/forms';

// Mêmes bornes que l'API (apps/api/src/auth/auth.dto.ts).
export const passwordValidators = [Validators.required, Validators.minLength(10), Validators.maxLength(128)];
export const emailValidators = [Validators.required, Validators.email, Validators.maxLength(254)];

/** Message affichable pour une erreur HTTP ; 429 et erreurs réseau/serveur ont un message commun. */
export function errorMessage(err: unknown, byStatus: Partial<Record<number, string>> = {}): string {
  const status = err instanceof HttpErrorResponse ? err.status : 0;
  if (byStatus[status]) return byStatus[status];
  if (status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  return 'Le service est indisponible. Réessayez plus tard.';
}
