import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { API_BASE, ApiClient } from './api-client';

// L'en-tête X-CSRF-Token est posé par withXsrfConfiguration (http.ts), en amont de cet intercepteur.
// Ici : cookies envoyés, 409 ⇒ événement « conflit », 401 ⇒ un seul refresh puis un seul rejeu.
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(ApiClient);

  const send = (r: HttpRequest<unknown>, canRefresh: boolean): Observable<HttpEvent<unknown>> =>
    next(r).pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          if (err.status === 409) api.conflicts.next(err);
          if (err.status === 401 && canRefresh) {
            return api.refreshSession().pipe(
              // Refresh refusé : l'appelant reçoit le 401 d'origine (session expirée).
              catchError(() => throwError(() => err)),
              switchMap(() => send(r, false)),
            );
          }
        }
        return throwError(() => err);
      }),
    );

  // Routes d'auth exclues : un 401 au login est un mauvais mot de passe, et le refresh ne se rafraîchit pas lui-même.
  return send(req.clone({ withCredentials: true }), !req.url.startsWith(`${API_BASE}/auth/`));
};
