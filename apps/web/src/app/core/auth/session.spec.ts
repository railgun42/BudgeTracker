import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideApiHttp } from '../http';
import { Session } from './session';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };

describe('Session', () => {
  let session: Session;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideApiHttp(), provideHttpClientTesting()] });
    session = TestBed.inject(Session);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('restore() : un seul GET /me partagé, utilisateur exposé en signal', async () => {
    const [a, b] = [session.restore(), session.restore()];
    http.expectOne('/api/v1/me').flush(USER);
    await Promise.all([a, b]);
    expect(session.user()).toEqual(USER);
  });

  it('restore() : session absente ⇒ user() null, sans erreur', async () => {
    const done = session.restore();
    http.expectOne('/api/v1/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(session.user()).toBeNull();
  });

  it('login() pose l’utilisateur ; logout() le retire même si l’API échoue', () => {
    session.login({ email: 'alice@example.com', password: 'x' }).subscribe();
    const login = http.expectOne('/api/v1/auth/login');
    expect(login.request.body).toEqual({ email: 'alice@example.com', password: 'x' });
    login.flush(USER);
    expect(session.user()).toEqual(USER);

    session.logout().subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 500, statusText: 'Error' });
    expect(session.user()).toBeNull();
  });
});
