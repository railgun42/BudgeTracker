import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CategoryDto, CategoryStatDto, MonthlyStatDto, TagStatDto, TrackingType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';
import { fillMonths, monthLabel, previousRange } from './stats-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const ACCOUNTS: AccountDto[] = [{ id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 }];
const CATEGORIES: CategoryDto[] = [
  { id: 'c1', parentId: null, system: true, nameKey: 'groceries', name: null, color: null, hidden: false, customName: null, archived: false },
  { id: 'c2', parentId: 'c1', system: true, nameKey: 'groceries.food', name: null, color: null, hidden: false, customName: null, archived: false },
  { id: 'c3', parentId: null, system: false, nameKey: null, name: 'Salaire', color: null, hidden: false, customName: null, archived: false },
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
const PREVIOUS: MonthlyStatDto[] = [{ month: '2025-06', incomeCents: 200000, expenseCents: 100000 }];
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

/**
 * Répond aux trois agrégats (mêmes paramètres pour les trois) et, si Du et Au sont remplis, au mensuel de la période
 * précédente ; renvoie la requête mensuelle de la période choisie.
 */
async function stats(monthly = MONTHLY, byCategory = BY_CATEGORY, byTag = BY_TAG, previous = PREVIOUS): Promise<TestRequest> {
  const others = [http.expectOne((r) => r.url === '/api/v1/stats/by-category'), http.expectOne((r) => r.url === '/api/v1/stats/by-tag')];
  const months = http.match((r) => r.url === '/api/v1/stats/monthly');
  const req = months.find((m) => JSON.stringify(params(m)) === JSON.stringify(params(others[0])))!;
  expect(params(others[1])).toEqual(params(req));
  const prev = months.filter((m) => m !== req);
  expect(prev).toHaveLength(params(req)['from'] && params(req)['to'] ? 1 : 0);
  req.flush(monthly);
  others[0].flush(byCategory);
  others[1].flush(byTag);
  prev[0]?.flush(previous);
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
    expect(rows('Évolution mensuelle')).toEqual([
      'janvier 2026 | +2 500,00 € | −845,67 € | +1 654,33 €',
      'février 2026 | 0,00 € | −1 250,00 € | −1 250,00 €',
    ]);
    // Regroupé par racine (dépenses décroissantes) ; la sous-catégorie suit sa racine, lue « Parent › Enfant ».
    expect(rows('Par catégorie')).toEqual([
      'Courses | 0,00 € | −76,00 € | −76,00 €',
      'Courses › Alimentaire | 0,00 € | −76,00 € | −76,00 €',
      'Sans catégorie | 0,00 € | −12,34 € | −12,34 €',
      'Salaire | +5 000,00 € | 0,00 € | +5 000,00 €',
    ]);
    expect(section('Par catégorie').querySelector('tr.sub .visually-hidden')?.textContent).toBe('Courses › ');
    expect(rows('Par tag')).toEqual(['Vacances | 0,00 € | −58,00 € | −58,00 €']);
    expect(section('Par tag').querySelector('caption')?.textContent).toContain('Par tag');
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
    http.match((r) => r.url === '/api/v1/stats/monthly')[0].flush(null, { status: 404, statusText: '404' });
    http.match((r) => r.url.startsWith('/api/v1/stats/')); // les autres, annulées par forkJoin
    await stable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Ce compte n’existe plus');
  });

  it('synthèse : totaux, moyenne mensuelle et écart avec la période précédente de même durée', async () => {
    await open();
    const cards = [...el.querySelectorAll('.stat')].map((c) => [...c.querySelectorAll('p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim()).join(' | '));
    expect(cards).toEqual([
      'Revenus | +2 500,00 € | +500,00 € par rapport à la période précédente',
      'Dépenses | −2 095,67 € | −1 095,67 € par rapport à la période précédente',
      'Solde net | +404,33 € | −595,67 € par rapport à la période précédente',
      'Dépenses par mois | −1 047,84 € | Moyenne sur 2 mois',
    ]);
    expect(el.querySelectorAll('.stat-value.debit')).toHaveLength(2);
    expect(el.textContent).toContain(`Période précédente : du 1 janv. ${+YEAR - 1} au 31 déc. ${+YEAR - 1}.`);
  });

  it('période rapide « Ce mois » ⇒ dates remplies, chargement immédiat, bouton pressé', async () => {
    await open();
    const month = today().slice(0, 7);
    const button = [...el.querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) => b.textContent === 'Ce mois')!;
    button.click();
    const req = await stats();
    expect(params(req)['from']).toBe(`${month}-01`);
    expect(el.querySelector<HTMLInputElement>('#s-from')!.value).toBe(`${month}-01`);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('filtres appliqués dès qu’ils changent (après un court délai)', async () => {
    await open();
    type('s-account', 'a1');
    await new Promise((r) => setTimeout(r, 350));
    const req = await stats();
    expect(params(req)['accountId']).toBe('a1');
  });

  it('donut des dépenses par racine : parts en pourcentage, légende écrite ; icône sur chaque racine', async () => {
    await open();
    const legend = [...section('Par catégorie').querySelectorAll('.legend li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(legend).toEqual(['Courses, 86 %', 'Sans catégorie, 14 %']);
    expect(section('Par catégorie').querySelectorAll('circle')).toHaveLength(2);
    expect(section('Par catégorie').querySelectorAll('tbody .category-icon')).toHaveLength(3);
    expect(section('Par catégorie').querySelectorAll('tr.sub .category-icon')).toHaveLength(0);
    expect(section('Évolution mensuelle').querySelector('svg[role=img]')?.getAttribute('aria-label')).toContain('tableau');
  });

  it('donut : survol d’une part ⇒ nom de la catégorie ; case décochée ⇒ part retirée, pourcentages recalculés', async () => {
    await open();
    const donut = section('Par catégorie').querySelector('.donut')!;
    donut.querySelectorAll('circle')[1].dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    await stable();
    const tip = [...donut.querySelector('.tooltip')!.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(tip).toEqual(['Sans catégorie', '14 % · −12,34 €']);
    donut.querySelector('.donut-plot')!.dispatchEvent(new MouseEvent('pointerleave'));
    await stable();
    expect(donut.querySelector('.tooltip')).toBeNull();

    const boxes = donut.querySelectorAll<HTMLInputElement>('.legend input[type=checkbox]');
    expect([...boxes].map((b) => b.checked)).toEqual([true, true]);
    boxes[0].click();
    await stable();
    const legend = [...donut.querySelectorAll('.legend li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(legend).toEqual(['Courses, retirée', 'Sans catégorie, 100 %']);
    expect(donut.querySelectorAll('circle')).toHaveLength(1);
    boxes[1].click();
    await stable();
    expect(donut.querySelectorAll('circle')).toHaveLength(0);
    expect(donut.textContent).toContain('Rien de coché.');
    // Le tableau garde toutes les catégories.
    expect(rows('Par catégorie')).toHaveLength(4);
  });

  it('détailler une catégorie ⇒ donut de ses sous-catégories et de ses tags (filtres appliqués, catégorie envoyée)', async () => {
    await open();
    const options = [...el.querySelectorAll<HTMLOptionElement>('#s-detail option')].map((o) => o.textContent!.trim());
    expect(options).toEqual(['Aucune', 'Courses', 'Salaire']); // racines connues ; pas « Sans catégorie »
    type('s-detail', 'c1');
    const req = http.expectOne((r) => r.url === '/api/v1/stats/by-tag');
    expect(params(req)).toEqual({ from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, categoryId: 'c1' });
    req.flush([{ tagId: 'g1', incomeCents: 0, expenseCents: 5800 }]);
    await stable();
    const detail = el.querySelector('.detail')!;
    expect(detail.querySelector('h3')?.textContent).toBe('Courses');
    const legends = [...detail.querySelectorAll('.legend')].map((ul) =>
      [...ul.querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim()),
    );
    expect(legends).toEqual([['Alimentaire, 100 %'], ['Vacances, 100 %']]);
    expect(detail.textContent).toContain('compte pour chacun');
    const cells = [...detail.querySelectorAll('tbody tr > *')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual(['Vacances', '−58,00 €']);

    // Les filtres rechargés rechargent aussi les tags de la catégorie détaillée.
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await stats();
    http.expectOne((r) => r.url === '/api/v1/stats/by-tag').flush([]);
    await stable();
    expect(el.querySelector('.detail')!.textContent).toContain('Aucune dépense taguée');
  });

  it('previousRange : mois entiers décalés en mois, sinon en jours ; fillMonths comble les mois vides', () => {
    expect(previousRange('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousRange('2026-03-10', '2026-03-19')).toEqual({ from: '2026-02-28', to: '2026-03-09' });
    expect(previousRange('2026-03-19', '2026-03-10')).toBeNull();
    expect(fillMonths([MONTHLY[0], { month: '2026-03', incomeCents: 1, expenseCents: 0 }]).map((m) => m.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('monthLabel : « 2026-12 » ⇒ « décembre 2026 » quel que soit le fuseau', () => {
    expect(monthLabel('2026-12')).toBe('décembre 2026');
  });
});
