import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminStatsDto } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { formatBytes, formatDuration } from './admin-page';

const ADMIN = { id: 'u1', email: 'admin@example.com', name: 'Admin', lastConnection: null, role: 'ADMIN' };
const STATS: AdminStatsDto = {
  users: { total: 1234, verified: 1000, new7d: 12, new30d: 40, active7d: 300, active30d: 800 },
  volumes: { accounts: 2000, transactions: 56789, recurrences: 150, attachments: 42, storageBytes: 5 * 1024 * 1024 },
  database: { sizeBytes: 1536 * 1024, latencyMs: 1.4 },
  api: {
    startedAt: '2026-10-15T08:00:00.000Z',
    uptimeSeconds: 93_784,
    memoryRssBytes: 120 * 1024 * 1024,
    errorsSinceStart: 3,
    jobs: { recurrences: { at: '2026-10-15T01:00:00.000Z', ok: true }, interest: null, purge: { at: '2026-10-15T03:00:00.000Z', ok: false } },
  },
};

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
/** Libellé <dt> → valeur <dd>. */
const values = () => Object.fromEntries([...el.querySelectorAll('dt')].map((dt) => [clean(dt.textContent), clean(dt.nextElementSibling?.textContent)]));
/** Libellé <dt> → texte de la pastille de santé de la ligne. */
const health = () =>
  Object.fromEntries([...el.querySelectorAll('.api-row')].map((row) => [clean(row.querySelector('dt')?.textContent), clean(row.querySelector('.health')?.textContent)]));
/** Libellé <dt> → aide de la carte chiffrée. */
const hints = () => Object.fromEntries([...el.querySelectorAll('.stat')].map((c) => [clean(c.querySelector('dt')?.textContent), clean(c.querySelector('.stat-hint')?.textContent)]));
const status = () => clean(el.querySelector('[role="status"]')?.textContent);
const button = (text: string) => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === text);

describe('AdminPage', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const done = TestBed.inject(Session).restore();
    http.expectOne('/api/v1/me').flush(ADMIN);
    await done;
    harness = await RouterTestingHarness.create('/admin');
    el = harness.routeNativeElement!;
  });

  afterEach(() => http.verify());

  it('affiche les agrégats : utilisateurs, volumes, état de l’API et des tâches', async () => {
    expect(status()).toBe('Chargement…');
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    const v = values();
    expect(v['Total']).toBe('1 234');
    expect(v['Nouveaux (7 j / 30 j)']).toBe('12 / 40');
    expect(v['Actifs (7 j / 30 j)']).toBe('300 / 800');
    expect(v['Transactions']).toBe('56 789');
    expect(v['Pièces jointes']).toBe('42');
    expect(hints()['Pièces jointes']).toBe('5 Mo stockés');
    expect(hints()['E-mail vérifié']).toMatch(/^81\s%\sdes inscrits$/);
    expect(hints()['Actifs (7 j / 30 j)']).toMatch(/^65\s%\sactifs sur 30 j$/);
    expect(v['Taille de la base']).toBe('1,5 Mo');
    expect(v['Latence de la base']).toBe('1,4 ms');
    expect(v['En service depuis']).toMatch(/^1 j 2 h 3 min \(depuis le 15 oct\. 2026/);
    expect(v['Erreurs serveur depuis le démarrage']).toBe('3');
    expect(v['Crédit des intérêts']).toBe('pas encore exécutée depuis le démarrage');
    expect(el.querySelector('.api-row time')?.getAttribute('datetime')).toBe('2026-10-15T01:00:00.000Z');
    // État écrit (texte), la couleur ne fait que doubler ; rouge pour l'échec et les erreurs seulement.
    expect(health()).toEqual({
      'En service depuis': undefined,
      'Latence de la base': 'OK',
      Mémoire: undefined,
      'Erreurs serveur depuis le démarrage': 'À examiner',
      'Génération des récurrences': 'Réussie',
      'Crédit des intérêts': 'En attente',
      'Purge des suppressions': 'En échec',
    });
    expect(el.querySelector('.health-error')).toBeTruthy();
    expect(el.querySelectorAll('.health svg[aria-hidden="true"]').length).toBe(5);
    expect(status()).toMatch(/^Mis à jour à \d\d:\d\d$/);
    expect(clean(el.querySelector('a[href="/admin/categories"]')?.textContent)).toBe('Catégories globales');
    expect(clean(el.querySelector('a[href="/admin/feedback"]')?.textContent)).toBe('Retours utilisateurs');
    expect(clean(el.querySelector('a[href="/admin/suggestions"]')?.textContent)).toBe('Suggestions de catégorie');
    expect(clean(el.querySelector('a[href="/admin/notifications"]')?.textContent)).toBe('Notifications et annonces');
  });

  it('Actualiser relance la requête ; une erreur s’affiche dans une alerte', async () => {
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    expect(el.querySelector('.confirm-pop')).toBeNull();
    button('Actualiser')!.click();
    await harness.fixture.whenStable();
    expect(status()).toBe('Actualisation…');
    expect(button('Actualisation…')?.disabled).toBe(true);
    expect(values()['Total']).toBe('1 234'); // les blocs restent visibles pendant l'actualisation
    http.expectOne('/api/v1/admin/stats').flush(null, { status: 403, statusText: 'Forbidden' });
    await harness.fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Accès réservé aux administrateurs.');
    button('Recharger')!.click();
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('.card.confirm-pop').length).toBe(10);
  });

  it('valeurs à zéro, latence lente, aucune erreur, tâches en attente', async () => {
    http.expectOne('/api/v1/admin/stats').flush({
      ...STATS,
      users: { total: 0, verified: 0, new7d: 0, new30d: 0, active7d: 0, active30d: 0 },
      database: { sizeBytes: 0, latencyMs: 250 },
      api: { ...STATS.api, errorsSinceStart: 0, jobs: { recurrences: null, interest: null, purge: null } },
    });
    await harness.fixture.whenStable();
    expect(values()['Total']).toBe('0');
    expect(hints()['E-mail vérifié']).toBeUndefined(); // pas de pourcentage sur 0 inscrit
    expect(values()['Taille de la base']).toBe('0 o');
    const h = health();
    expect([h['Latence de la base'], h['Erreurs serveur depuis le démarrage'], h['Purge des suppressions']]).toEqual(['Lente', 'OK', 'En attente']);
    expect(el.querySelector('.health-error')).toBeNull();
  });

  it('les sous-pages sont des cartes-liens décrites', async () => {
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    const link = el.querySelector('a[href="/admin/feedback"]')!;
    expect(el.querySelector(`#${link.getAttribute('aria-describedby')}`)?.textContent).toContain('Lire les avis');
    expect(el.querySelectorAll('nav[aria-label="Administration"] .link-card').length).toBe(4);
  });
});

describe('formatage', () => {
  it.each([
    [0, '0 o'],
    [1536, '1,5 Ko'],
    [5 * 1024 ** 3, '5 Go'],
  ])('formatBytes(%s) = %s', (bytes, text) => expect(formatBytes(bytes)).toBe(text));

  it.each([
    [59, '0 min'],
    [3600, '1 h 0 min'],
    [86_400 + 60, '1 j 0 h 1 min'],
  ])('formatDuration(%s) = %s', (seconds, text) => expect(formatDuration(seconds)).toBe(text));
});
