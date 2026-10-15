import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { Session } from './core/auth/session';
import { provideApiHttp } from './core/http';
import { today } from './core/today';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null, role: 'USER' };
const ADMIN = { ...USER, role: 'ADMIN' };

// compileComponents : la coquille contient des blocs @defer (modale de saisie rapide).
beforeEach(() =>
  TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] }).compileComponents(),
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
      ['Catégories', '/categories'],
      ['Statistiques', '/stats'],
      ['Simulations', '/simulations'],
    ]);
    // Menu du compte (popover) : compte, avis, déconnexion.
    const menu = el.querySelector('header #account-menu[popover]');
    expect([...menu!.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Mon compte', '/me'],
      ['Donner mon avis', '/feedback'],
    ]);
    expect(el.querySelector('header button[popovertarget="account-menu"]')?.getAttribute('aria-label')).toBe('Menu du compte (Alice)');
    expect(el.querySelector('header button[popovertarget="main-nav"]')).not.toBeNull();
    expect(el.querySelector('.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('main#main router-outlet')).not.toBeNull();
    expect(menu!.querySelector('button.logout')?.textContent).toContain('Se déconnecter');
    // Cloche hors de la navigation principale, alimentée par GET /notifications.
    TestBed.inject(HttpTestingController).match('/api/v1/notifications').forEach((r) => r.flush({ unreadCount: 2, items: [] }));
    await fixture.whenStable();
    expect(el.querySelector('header a[href="/notifications"]')?.getAttribute('aria-label')).toBe('Notifications (2 non lues)');
  });

  it('lien Administration : absent pour un utilisateur ordinaire, présent pour un admin', async () => {
    const adminLinks = async (user: typeof USER) => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] }).compileComponents();
      await restore(user);
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/admin').map((a) => a.textContent?.trim());
    };
    expect(await adminLinks(USER)).toEqual([]);
    expect(await adminLinks(ADMIN)).toEqual(['Administration']);
  });

  it('invité : ni navigation ni bouton de déconnexion', async () => {
    await restore(null);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav[aria-label="Navigation principale"]')).toBeNull();
    expect(el.querySelector('header button')).toBeNull();
  });

  it.each([true, false])('pied de page légal pour tous (connecté : %s)', async (loggedIn) => {
    await restore(loggedIn ? USER : null);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer nav[aria-label="Informations légales"]');
    const links = [...footer!.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['Mentions légales', '/mentions-legales'],
      ['Confidentialité', '/confidentialite'],
      ['CGU', '/cgu'],
    ]);
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
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('header button.logout')!.click();

    const req = TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect((fixture.nativeElement as HTMLElement).querySelector('nav[aria-label="Navigation principale"]')).toBeNull();
  });
});

describe('Saisie rapide en modale (coquille)', () => {
  const COURANT = { id: 'a1', name: 'Courant', trackingType: 'NORMAL', openingDate: null, version: 1 };
  const LIVRET = { ...COURANT, id: 'a2', name: 'Livret' };
  const balanceUrl = (id: string) => `/api/v1/accounts/${id}/balance?today=${today()}`;

  // jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };

  /** Coquille sur /accounts, un compte « Courant ». */
  async function onAccounts() {
    await restore(USER);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/accounts');
    await fixture.whenStable();
    http.expectOne('/api/v1/accounts').flush([COURANT]);
    http.expectOne(balanceUrl('a1')).flush({ currentCents: 10000, forecastCents: 10000 });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = el.querySelector('dialog[aria-labelledby="entry-title"]')!;
    const fill = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    return { http, fixture, el, dialog, fill };
  }

  it('« + Transaction » ouvre la modale sur la page courante ; succès ⇒ modale fermée, bandeau, soldes relus', async () => {
    const { http, fixture, el, dialog, fill } = await onAccounts();
    el.querySelector<HTMLButtonElement>('header button.add-button')!.click();
    await fixture.whenStable();

    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('entry-title');
    expect(dialog.querySelector('#entry-title')?.textContent).toBe('Ajouter une transaction');
    expect(dialog.querySelector('h1')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/accounts');
    http.expectOne('/api/v1/accounts').flush([COURANT]);
    http.expectOne('/api/v1/categories').flush([]);
    await fixture.whenStable();

    fill('tx-amount', '12,34');
    dialog.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http.expectOne('/api/v1/transactions').flush({});
    await fixture.whenStable();

    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('form')).toBeNull();
    expect(el.querySelector('.toast[role="status"]')?.textContent).toContain('Transaction enregistrée.');
    expect(TestBed.inject(Router).url).toBe('/accounts');
    // La page Comptes relit ses soldes.
    http.expectOne('/api/v1/accounts').flush([COURANT]);
    http.expectOne(balanceUrl('a1')).flush({ currentCents: 8766, forecastCents: 8766 });
    await fixture.whenStable();
    expect(el.querySelector('.balance')?.textContent).toContain('87,66');
  });

  it('virement depuis Comptes : modale sans h1 ni « Retour aux comptes », Annuler la ferme ; succès ⇒ bandeau', async () => {
    const { http, fixture, el, dialog, fill } = await onAccounts();
    const openTransfer = async () => {
      [...el.querySelectorAll<HTMLButtonElement>('main button')].find((b) => b.textContent?.includes('Faire un virement'))!.click();
      await fixture.whenStable();
      http.expectOne('/api/v1/accounts').flush([COURANT, LIVRET]);
      await fixture.whenStable();
    };

    await openTransfer();
    expect(dialog.querySelector('#entry-title')?.textContent).toBe('Nouveau virement');
    expect(dialog.querySelector('h1')).toBeNull();
    expect(dialog.textContent).not.toContain('Retour aux comptes');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Annuler')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);

    await openTransfer();
    fill('transfer-from', 'a1');
    fill('transfer-to', 'a2');
    fill('transfer-amount', '10');
    dialog.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    const req = http.expectOne('/api/v1/transfers');
    expect(req.request.body).toMatchObject({ fromAccountId: 'a1', toAccountId: 'a2', amountCents: 1000 });
    req.flush({});
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(el.querySelector('.toast')?.textContent).toContain('Virement enregistré.');
    http.expectOne('/api/v1/accounts').flush([COURANT, LIVRET]);
  });
});

describe('Thème', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('auto par défaut, choix « Sombre » appliqué et mémorisé, retour à « Auto »', async () => {
    await restore(USER);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const pick = async (label: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent?.trim() === label)!.click();
      await fixture.whenStable();
    };
    const pressed = () => el.querySelector('.segmented [aria-pressed="true"]')?.textContent?.trim();

    expect(pressed()).toBe('Auto');
    expect(document.documentElement.dataset['theme']).toBeUndefined();

    await pick('Sombre');
    expect(pressed()).toBe('Sombre');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    await pick('Auto');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem('theme')).toBeNull();
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
    ['/me', 'Mon compte'],
    ['/feedback', 'Donner mon avis'],
    ['/notifications', 'Notifications'],
    ['/login', 'Connexion'],
    ['/signup', 'Créer un compte'],
    ['/forgot-password', 'Mot de passe oublié'],
    ['/reset-password', 'Nouveau mot de passe'],
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'Politique de confidentialité'],
    ['/cgu', 'Conditions générales d’utilisation'],
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

  it('seuls les écrans d’auth, les pages légales et la 404 sont publics', () => {
    const publicPaths = routes.filter((r) => !r.canActivate).map((r) => r.path);
    expect(publicPaths).toEqual([
      'login',
      'signup',
      'verify-email',
      'forgot-password',
      'reset-password',
      'mentions-legales',
      'confidentialite',
      'cgu',
      '**',
    ]);
  });
});

describe('adminGuard', () => {
  it('admin ⇒ page d’administration', async () => {
    await restore(ADMIN);
    const harness = await RouterTestingHarness.create('/admin');
    TestBed.inject(HttpTestingController).expectOne('/api/v1/admin/stats');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Administration');
    expect(TestBed.inject(Title).getTitle()).toBe('Administration');
  });

  it('utilisateur ordinaire ⇒ renvoyé au tableau de bord, sans appel à /admin/stats', async () => {
    await restore(USER);
    const harness = await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Tableau de bord');
    TestBed.inject(HttpTestingController).expectNone('/api/v1/admin/stats');
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
