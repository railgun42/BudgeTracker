import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from './api-client';
import { provideApiHttp } from './http';

const REFRESH = '/api/v1/auth/refresh';
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('Intercepteurs HTTP', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    document.cookie = 'csrf_token=jeton-csrf; path=/';
    TestBed.configureTestingModule({ providers: [provideApiHttp(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('CSRF et cookies', () => {
    it.each([
      ['POST', () => api.post('/accounts', { name: 'Courant' })],
      ['PATCH', () => api.patch('/accounts/1', { name: 'Courant' })],
      ['DELETE', () => api.delete('/accounts/1')],
    ])('%s porte X-CSRF-Token = cookie csrf_token et withCredentials', (method, call) => {
      call().subscribe();
      const req = http.expectOne('/api/v1/accounts' + (method === 'POST' ? '' : '/1'));
      expect(req.request.method).toBe(method);
      expect(req.request.headers.get('X-CSRF-Token')).toBe('jeton-csrf');
      expect(req.request.withCredentials).toBe(true);
      req.flush(null);
    });

    it('GET n’a pas d’en-tête CSRF, envoie les cookies et ignore les filtres undefined', () => {
      api.get('/transactions', { limit: 50, accountId: undefined }).subscribe();
      const req = http.expectOne('/api/v1/transactions?limit=50');
      expect(req.request.headers.has('X-CSRF-Token')).toBe(false);
      expect(req.request.withCredentials).toBe(true);
      req.flush([]);
    });
  });

  describe('401 ⇒ refresh puis rejeu', () => {
    it('rafraîchit une fois (avec CSRF) puis rejoue la requête', () => {
      let result: unknown;
      api.get('/me').subscribe((r) => (result = r));

      http.expectOne('/api/v1/me').flush(null, unauthorized);
      const refresh = http.expectOne(REFRESH);
      expect(refresh.request.method).toBe('POST');
      expect(refresh.request.headers.get('X-CSRF-Token')).toBe('jeton-csrf');
      refresh.flush(null, { status: 204, statusText: 'No Content' });
      http.expectOne('/api/v1/me').flush({ id: 'u1' });

      expect(result).toEqual({ id: 'u1' });
    });

    it('ne rejoue qu’une seule fois : un 401 au rejeu est renvoyé sans nouveau refresh', () => {
      let error: HttpErrorResponse | undefined;
      api.get('/me').subscribe({ error: (e) => (error = e) });

      http.expectOne('/api/v1/me').flush(null, unauthorized);
      http.expectOne(REFRESH).flush(null);
      http.expectOne('/api/v1/me').flush(null, unauthorized);
      http.expectNone(REFRESH);

      expect(error?.status).toBe(401);
    });

    it('des 401 simultanés partagent un seul refresh, puis chaque requête est rejouée', () => {
      const results: unknown[] = [];
      api.get('/accounts').subscribe((r) => results.push(r));
      api.get('/categories').subscribe((r) => results.push(r));

      http.expectOne('/api/v1/accounts').flush(null, unauthorized);
      http.expectOne('/api/v1/categories').flush(null, unauthorized);
      http.expectOne(REFRESH).flush(null);
      http.expectOne('/api/v1/accounts').flush(['a']);
      http.expectOne('/api/v1/categories').flush(['c']);

      expect(results).toEqual([['a'], ['c']]);
    });

    it('refresh refusé ⇒ l’appelant reçoit le 401 d’origine, sans rejeu', () => {
      let error: HttpErrorResponse | undefined;
      api.get('/me').subscribe({ error: (e) => (error = e) });

      http.expectOne('/api/v1/me').flush({ message: 'expiré' }, unauthorized);
      http.expectOne(REFRESH).flush(null, unauthorized);

      expect(error?.url).toBe('/api/v1/me');
      expect(error?.status).toBe(401);
    });

    it('un 401 sur une route d’auth (mauvais mot de passe) ne déclenche pas de refresh', () => {
      let error: HttpErrorResponse | undefined;
      api.post('/auth/login', { email: 'a@b.c', password: 'x' }).subscribe({ error: (e) => (error = e) });

      http.expectOne('/api/v1/auth/login').flush(null, unauthorized);
      http.expectNone(REFRESH);
      expect(error?.status).toBe(401);
    });
  });

  describe('409 ⇒ événement « conflit »', () => {
    it('émet le conflit et propage l’erreur à l’appelant', () => {
      const conflicts: HttpErrorResponse[] = [];
      api.conflicts.subscribe((e) => conflicts.push(e));
      let error: HttpErrorResponse | undefined;
      api.patch('/transactions/t1', { version: 1 }).subscribe({ error: (e) => (error = e) });

      http.expectOne('/api/v1/transactions/t1').flush({ message: 'Version périmée' }, { status: 409, statusText: 'Conflict' });

      expect(conflicts.map((e) => e.status)).toEqual([409]);
      expect(error?.status).toBe(409);
    });

    it('n’émet rien sur les autres erreurs', () => {
      const conflicts: HttpErrorResponse[] = [];
      api.conflicts.subscribe((e) => conflicts.push(e));
      api.get('/accounts/x').subscribe({ error: () => undefined });

      http.expectOne('/api/v1/accounts/x').flush(null, { status: 404, statusText: 'Not Found' });
      expect(conflicts).toEqual([]);
    });
  });
});
