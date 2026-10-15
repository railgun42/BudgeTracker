import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { finalize, Observable, share, Subject } from 'rxjs';

export const API_BASE = '/api/v1';

type Params = Record<string, string | number | boolean | undefined>;

// Point d'entrée HTTP unique des features : chemins relatifs à /api/v1 (même origine, cookies + CSRF par les intercepteurs).
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  /** Émis sur chaque 409 (version périmée) : l'UI propose de recharger. L'erreur est aussi propagée à l'appelant. */
  readonly conflicts = new Subject<HttpErrorResponse>();

  private refreshing: Observable<void> | null = null;

  /** Rotation des cookies de session ; les appels simultanés partagent une seule requête. */
  refreshSession(): Observable<void> {
    return (this.refreshing ??= this.post<void>('/auth/refresh').pipe(
      finalize(() => (this.refreshing = null)),
      share(),
    ));
  }

  get<T>(path: string, params?: Params): Observable<T> {
    return this.http.get<T>(API_BASE + path, { params: toParams(params) });
  }

  post<T>(path: string, body: unknown = null): Observable<T> {
    return this.http.post<T>(API_BASE + path, body);
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(API_BASE + path, body);
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(API_BASE + path, body);
  }

  /** Fichier à télécharger (export) : même chemin d'intercepteurs, donc refresh sur 401. */
  download(path: string, params?: Params): Observable<Blob> {
    return this.http.get(API_BASE + path, { params: toParams(params), responseType: 'blob' });
  }

  delete<T = void>(path: string): Observable<T> {
    return this.http.delete<T>(API_BASE + path);
  }
}

// Filtres optionnels : les valeurs undefined ne partent pas dans l'URL.
function toParams(params: Params = {}): HttpParams {
  return Object.entries(params).reduce(
    (p, [k, v]) => (v === undefined ? p : p.set(k, String(v))),
    new HttpParams(),
  );
}
