import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { Session } from './core/auth/session';
import { provideApiHttp } from './core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };

beforeEach(() =>
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] }),
);

/** Session restaurée par GET /me : connecté (user) ou invité (401). */
async function restore(user: typeof USER | null): Promise<void> {
  const done = TestBed.inject(Session).restore();
  const req = TestBed.inject(HttpTestingController).expectOne('/api/v1/me');
  if (user) req.flush(user);
  else req.flush(null, { status: 401, statusText: 'Unauthorized' });
  // GET /me en 401 ⇒ l'intercepteur tente un refresh, refusé lui aussi.
  if (!user) TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
  await done;
}

describe('Shell', () => {
  it('connecté : navigation principale, lien d’évitement et déconnexion', async () => {
    await restore(USER);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const nav = el.querySelector('nav[aria-label="Navigation principale"]');
    const links = [...nav!.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['Tableau de bord', '/'],
      ['Comptes', '/accounts'],
      ['Historique', '/history'],
      ['Récurrences', '/recurrences'],
      ['Statistiques', '/stats'],
      ['Simulations', '/simulations'],
    ]);
    expect(el.querySelector('.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('main#main router-outlet')).not.toBeNull();
    expect(el.querySelector('header button')?.textContent).toContain('Se déconnecter');
  });

  it('invité : ni navigation ni bouton de déconnexion', async () => {
    await restore(null);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav')).toBeNull();
    expect(el.querySelector('header button')).toBeNull();
  });

  it('marque le lien actif avec aria-current', async () => {
    await restore(USER);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/history');
    await fixture.whenStable();
    const current = (fixture.nativeElement as HTMLElement).querySelectorAll('[aria-current="page"]');
    expect([...current].map((a) => a.textContent?.trim())).toEqual(['Historique']);
  });

  it('se déconnecter : POST /auth/logout, session vidée, retour à la connexion', async () => {
    await restore(USER);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('header button')!.click();

    const req = TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });
});

describe('Routes', () => {
  it.each([
    ['/', 'Tableau de bord'],
    ['/accounts', 'Mes comptes'],
    ['/transactions/new', 'Ajouter une transaction'],
    ['/transfers/new', 'Nouveau virement'],
    ['/history', 'Historique des transactions'],
    ['/stats', 'Statistiques'],
    ['/simulations', 'Simulations'],
    ['/login', 'Connexion'],
    ['/signup', 'Créer un compte'],
    ['/forgot-password', 'Mot de passe oublié'],
    ['/reset-password', 'Nouveau mot de passe'],
    ['/nimporte/quoi', 'Page introuvable'],
  ])('%s charge son écran en lazy et fixe le titre « %s »', async (url, title) => {
    await restore(USER);
    const harness = await RouterTestingHarness.create(url);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(title);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
  });

  it('toutes les routes sont en lazy loading', () => {
    expect(routes.every((r) => r.loadComponent && !r.component)).toBe(true);
  });

  it('seuls les écrans d’auth et la 404 sont publics', () => {
    const publicPaths = routes.filter((r) => !r.canActivate).map((r) => r.path);
    expect(publicPaths).toEqual(['login', 'signup', 'verify-email', 'forgot-password', 'reset-password', '**']);
  });
});

describe('authGuard', () => {
  it('invité ⇒ redirigé vers /login avec returnUrl, après un seul GET /me', async () => {
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/history?accountId=a1');
    const http = TestBed.inject(HttpTestingController);
    // Le guard s'exécute de façon asynchrone dans la navigation.
    const me = await vi.waitFor(() => http.expectOne('/api/v1/me'));
    me.flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
    await navigation;

    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fhistory%3FaccountId%3Da1');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Connexion');
    http.verify();
  });

  it('connecté ⇒ accès sans nouvel appel à /me', async () => {
    await restore(USER);
    const harness = await RouterTestingHarness.create('/accounts');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Mes comptes');
    TestBed.inject(HttpTestingController).expectNone('/api/v1/me');
  });
});
