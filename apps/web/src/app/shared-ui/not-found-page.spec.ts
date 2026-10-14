import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { Session } from '../core/auth/session';
import { provideApiHttp } from '../core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };

async function open404(user: typeof USER | null): Promise<HTMLAnchorElement> {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  const req = http.expectOne('/api/v1/me');
  if (user) req.flush(user);
  else {
    // GET /me en 401 ⇒ l'intercepteur tente un refresh, refusé lui aussi.
    req.flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
  }
  await restored;
  const harness = await RouterTestingHarness.create('/nimporte/quoi');
  http.verify();
  return harness.routeNativeElement!.querySelector('a')!;
}

describe('Page 404', () => {
  it('session ouverte ⇒ « Retour au tableau de bord » vers /', async () => {
    const link = await open404(USER);
    expect(link.textContent).toContain('tableau de bord');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('non connecté ⇒ « Se connecter » vers /login (la page réellement atteinte)', async () => {
    const link = await open404(null);
    expect(link.textContent).toContain('Se connecter');
    expect(link.getAttribute('href')).toBe('/login');
  });
});
