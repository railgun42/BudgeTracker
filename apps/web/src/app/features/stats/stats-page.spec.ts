import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CategoryDto, CategoryStatDto, MonthlyStatDto, TagStatDto, TrackingType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';
import { monthLabel } from './stats-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const ACCOUNTS: AccountDto[] = [{ id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 }];
const CATEGORIES: CategoryDto[] = [
  { id: 'c1', parentId: null, system: true, nameKey: 'groceries', name: null, color: null },
  { id: 'c2', parentId: 'c1', system: true, nameKey: 'groceries.food', name: null, color: null },
  { id: 'c3', parentId: null, system: false, nameKey: null, name: 'Salaire', color: null },
];
const TAGS = [{ id: 'g1', name: 'Vacances' }];
const MONTHLY: MonthlyStatDto[] = [
  { month: '2026-01', incomeCents: 250000, expenseCents: 84567 },
  { month: '2026-02', incomeCents: 0, expenseCents: 125000 },
];
const BY_CATEGORY: CategoryStatDto[] = [
  { categoryId: 'c2', incomeCents: 0, expenseCents: 7600 },
  { categoryId: 'c3', incomeCents: 500000, expenseCents: 0 },
  { categoryId: null, incomeCents: 0, expenseCents: 1234 },
];
const BY_TAG: TagStatDto[] = [{ tagId: 'g1', incomeCents: 0, expenseCents: 5800 }];
const YEAR = today().slice(0, 4);

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
const section = (title: string) => [...el.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title)!;
/** Une ligne = ses cellules jointes par « | ». */
const rows = (title: string) =>
  [...section(title).querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim()).join(' | '));
const params = (req: TestRequest) => Object.fromEntries(req.request.params.keys().map((k) => [k, req.request.params.get(k)]));

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

/** Répond aux trois agrégats ; renvoie la requête mensuelle (mêmes paramètres pour les trois). */
async function stats(monthly = MONTHLY, byCategory = BY_CATEGORY, byTag = BY_TAG): Promise<TestRequest> {
  const req = http.expectOne((r) => r.url === '/api/v1/stats/monthly');
  const others = [http.expectOne((r) => r.url === '/api/v1/stats/by-category'), http.expectOne((r) => r.url === '/api/v1/stats/by-tag')];
  expect(others.map(params)).toEqual([params(req), params(req)]);
  req.flush(monthly);
  others[0].flush(byCategory);
  others[1].flush(byTag);
  await stable();
  return req;
}

async function open(): Promise<TestRequest> {
  harness = await RouterTestingHarness.create('/stats');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/accounts').flush(ACCOUNTS);
  http.expectOne('/api/v1/categories').flush(CATEGORIES);
  http.expectOne('/api/v1/tags').flush(TAGS);
  return stats();
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Statistiques', () => {
  it('charge l’année en cours, tous comptes', async () => {
    const req = await open();
    expect(params(req)).toEqual({ from: `${YEAR}-01-01`, to: `${YEAR}-12-31` });
  });

  it('affiche mois, catégories « Parent › Enfant », tags et montants en euros', async () => {
    await open();
    expect(rows('Évolution mensuelle')).toEqual(['janvier 2026 | 2 500,00 € | 845,67 €', 'février 2026 | 0,00 € | 1 250,00 €']);
    expect(rows('Par catégorie')).toEqual([
      'Courses › Alimentaire | 0,00 € | 76,00 €',
      'Salaire | 5 000,00 € | 0,00 €',
      'Sans catégorie | 0,00 € | 12,34 €',
    ]);
    expect(rows('Par tag')).toEqual(['Vacances | 0,00 € | 58,00 €']);
  });

  it('barres proportionnelles au maximum de la section, masquées des lecteurs d’écran', async () => {
    await open();
    const bars = [...section('Évolution mensuelle').querySelectorAll<HTMLElement>('.bar')].map((b) => b.style.width);
    expect(bars).toEqual(['100%', '33.8268%', '0%', '50%']);
    expect(section('Par tag').querySelector('.bars')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('filtres envoyés à l’API ; date vide absente de l’URL', async () => {
    await open();
    type('s-from', '');
    type('s-to', '2026-03-31');
    type('s-account', 'a1');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    const req = await stats([], [], []);
    expect(params(req)).toEqual({ to: '2026-03-31', accountId: 'a1' });
    expect(el.querySelectorAll('table')).toHaveLength(0);
    expect([...el.querySelectorAll('section p')].map((p) => p.textContent)).toEqual(Array(3).fill('Aucune donnée sur cette période.'));
  });

  it('explique les exclusions et le double comptage des espèces', async () => {
    await open();
    expect(el.textContent).toContain('virements entre vos comptes sont exclus');
    expect(el.textContent).toContain('double comptage');
  });

  it('compte disparu (404) ⇒ message d’erreur', async () => {
    await open();
    type('s-account', 'a1');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    http.expectOne((r) => r.url === '/api/v1/stats/monthly').flush(null, { status: 404, statusText: '404' });
    http.match((r) => r.url.startsWith('/api/v1/stats/')); // les deux autres, annulées par forkJoin
    await stable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Ce compte n’existe plus');
  });

  it('monthLabel : « 2026-12 » ⇒ « décembre 2026 » quel que soit le fuseau', () => {
    expect(monthLabel('2026-12')).toBe('décembre 2026');
  });
});
