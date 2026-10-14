import { inject, Injectable, signal } from '@angular/core';
import { UserDto } from '@budgetracker/shared';
import { finalize, firstValueFrom, Observable, tap } from 'rxjs';
import { ApiClient } from '../api-client';

// État de session côté front : uniquement l'utilisateur renvoyé par l'API. Les jetons restent dans des cookies httpOnly.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(ApiClient);
  private readonly current = signal<UserDto | null>(null);
  private restoring?: Promise<void>;

  readonly user = this.current.asReadonly();

  /** GET /me une seule fois (au démarrage) ; pose aussi le cookie CSRF nécessaire aux POST d'auth. */
  restore(): Promise<void> {
    return (this.restoring ??= firstValueFrom(this.api.get<UserDto>('/me')).then(
      (user) => this.current.set(user),
      () => this.current.set(null),
    ));
  }

  login(credentials: { email: string; password: string }): Observable<UserDto> {
    return this.api.post<UserDto>('/auth/login', credentials).pipe(tap((user) => this.current.set(user)));
  }

  /** Suppression définitive du compte (RGPD) ; la session locale n'est vidée qu'en cas de succès. */
  deleteAccount(): Observable<void> {
    return this.api.delete('/me').pipe(tap(() => this.current.set(null)));
  }

  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout').pipe(finalize(() => this.current.set(null)));
  }
}
