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
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    const v = values();
    expect(v['Total']).toBe('1 234');
    expect(v['Nouveaux (7 j / 30 j)']).toBe('12 / 40');
    expect(v['Actifs (7 j / 30 j)']).toBe('300 / 800');
    expect(v['Transactions']).toBe('56 789');
    expect(v['Pièces jointes']).toBe('42 (5 Mo)');
    expect(v['Taille de la base']).toBe('1,5 Mo');
    expect(v['Latence de la base']).toBe('1.4 ms');
    expect(v['En service depuis']).toMatch(/^1 j 2 h 3 min/);
    expect(v['Erreurs serveur depuis le démarrage']).toBe('3');
    expect(v['Génération des récurrences']).toMatch(/réussie$/);
    expect(v['Crédit des intérêts']).toBe('pas encore exécutée depuis le démarrage');
    expect(v['Purge des suppressions']).toMatch(/en échec$/);
  });

  it('Actualiser relance la requête ; une erreur s’affiche dans une alerte', async () => {
    http.expectOne('/api/v1/admin/stats').flush(STATS);
    await harness.fixture.whenStable();
    [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === 'Actualiser')!.click();
    http.expectOne('/api/v1/admin/stats').flush(null, { status: 403, statusText: 'Forbidden' });
    await harness.fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Accès réservé aux administrateurs.');
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
