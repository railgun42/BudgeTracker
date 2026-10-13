import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CategoryDto, ScenarioComparisonDto, ScenarioDto, TrackingType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const ACCOUNTS: AccountDto[] = [
  { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, version: 1 },
  { id: 'a2', name: 'Portefeuille', trackingType: TrackingType.NOT_TRACKED, version: 1 },
];
const CATEGORIES: CategoryDto[] = [{ id: 'c1', parentId: null, system: true, nameKey: 'groceries', name: null, color: null }];
const SCENARIOS: ScenarioDto[] = [
  { id: 's1', name: 'Économe', params: { changes: [{ kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: -10_000 }] }, version: 1 },
  {
    id: 's2',
    name: 'Dépensier',
    params: {
      changes: [
        { kind: 'SUBSCRIPTION', monthlyCents: 1_299 },
        { kind: 'LOAN', principalCents: 100_000, annualRateBp: 350, months: 24 },
      ],
    },
    version: 1,
  },
];
const series = (balances: number[]) => ({
  averageMonthlySpendCents: 3_000,
  points: ['2026-03-31', '2026-04-30'].map((date, i) => ({ date, balanceCents: balances[i] })),
});
const COMPARISON: ScenarioComparisonDto = {
  baseline: series([91_000, 88_000]),
  scenarios: [
    { id: 's1', name: 'Économe', projection: series([91_000, 91_000]) },
    { id: 's2', name: 'Dépensier', projection: series([91_000, 36_500]) },
  ],
};

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
const text = (node: Element) => node.textContent!.replace(/\s+/g, ' ').trim();
const params = (req: TestRequest) => Object.fromEntries(req.request.params.keys().map((k) => [k, req.request.params.get(k)]));
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label)!;

async function type(id: string, value: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  await stable();
}

async function open(scenarios = SCENARIOS): Promise<void> {
  harness = await RouterTestingHarness.create('/simulations');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/accounts').flush(ACCOUNTS);
  http.expectOne('/api/v1/categories').flush(CATEGORIES);
  http.expectOne('/api/v1/scenarios').flush(scenarios);
  await stable();
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Simulations : scénarios « et si »', () => {
  it('liste les scénarios avec leurs modifications ; portefeuille non proposé à la comparaison', async () => {
    await open();
    expect([...el.querySelectorAll('ul[aria-label=Scénarios] > li')].map((li) => [...li.querySelectorAll('.changes li')].map(text))).toEqual([
      ['Courses : −100,00 € par mois'],
      ['Abonnement : 12,99 € par mois', 'Crédit : 1 000,00 € à 3,5 % sur 24 mois'],
    ]);
    expect([...el.querySelectorAll('#cmp-account option')].map(text)).toEqual(['Choisir un compte', 'Courant']);
    expect(el.textContent).toContain('vos données ne sont jamais modifiées');
  });

  it('compare deux scénarios côte à côte', async () => {
    await open();
    expect(button('Comparer').disabled).toBe(true);
    for (const box of el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) box.click();
    await type('cmp-account', 'a1');
    button('Comparer').click();
    const req = http.expectOne((r) => r.url === '/api/v1/scenarios/compare');
    expect(params(req)).toEqual({ accountId: 'a1', months: '12', ids: 's1,s2' });
    req.flush(COMPARISON);
    await stable();

    const table = el.querySelector('table')!;
    expect(text(table.querySelector('caption')!)).toBe('Solde projeté (rythme moyen des dépenses : 30,00 € par mois)');
    expect([...table.querySelectorAll('thead th')].map(text)).toEqual(['Date', 'Sans changement', 'Économe', 'Dépensier']);
    expect([...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text).join(' | '))).toEqual([
      '2026-03-31 | 910,00 € | 910,00 € | 910,00 €',
      '2026-04-30 | 880,00 € | 910,00 € | 365,00 €',
    ]);
  });

  it('graphique : légende, une courbe par série, infobulle au clavier ; tableau conservé', async () => {
    await open();
    for (const box of el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) box.click();
    await type('cmp-account', 'a1');
    button('Comparer').click();
    http.expectOne((r) => r.url === '/api/v1/scenarios/compare').flush(COMPARISON);
    await stable();

    const chart = el.querySelector('app-projection-chart')!;
    expect([...chart.querySelectorAll('.legend li')].map(text)).toEqual(['Sans changement', 'Économe', 'Dépensier']);
    const lines = [...chart.querySelectorAll('polyline')];
    expect(lines.map((l) => l.getAttribute('stroke'))).toEqual(['#57606a', '#2a78d6', '#eb6834']);
    expect(lines.every((l) => l.getAttribute('points')!.split(' ').length === 2)).toBe(true);
    // Courbe « Économe » plate (910 € puis 910 €), « Dépensier » en baisse : y plus grand = plus bas.
    const ys = (l: Element) => l.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[1]));
    expect(ys(lines[1])[0]).toBe(ys(lines[1])[1]);
    expect(ys(lines[2])[1]).toBeGreaterThan(ys(lines[2])[0]);

    const svg = chart.querySelector('svg')!;
    expect(svg.getAttribute('tabindex')).toBe('0');
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await stable();
    expect([...chart.querySelectorAll('.tooltip > *')].map(text)).toEqual([
      '2026-04-30',
      'Sans changement : 880,00 €',
      'Économe : 910,00 €',
      'Dépensier : 365,00 €',
    ]);
    expect(chart.querySelectorAll('circle')).toHaveLength(3);
    svg.dispatchEvent(new FocusEvent('blur'));
    await stable();
    expect(chart.querySelector('.tooltip')).toBeNull();
    expect(el.querySelector('table')).not.toBeNull();
  });

  it('modifier un scénario : formulaire prérempli, PATCH avec la version, comparaison périmée effacée', async () => {
    await open();
    button('Modifier Dépensier').click();
    await stable();
    expect(text(el.querySelector('#h-new')!)).toBe('Modifier « Dépensier »');
    const value = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!.value;
    expect([value('sc-name'), value('sc-kind-0'), value('sc-amount-0'), value('sc-kind-1'), value('sc-amount-1'), value('sc-rate-1'), value('sc-months-1')]).toEqual([
      'Dépensier',
      'SUBSCRIPTION',
      '12,99',
      'LOAN',
      '1000,00',
      '3,50',
      '24',
    ]);
    await type('sc-amount-0', '15');
    button('Enregistrer les modifications').click();

    const req = http.expectOne((r) => r.url === '/api/v1/scenarios/s2' && r.method === 'PATCH');
    expect(req.request.body).toEqual({
      version: 1,
      name: 'Dépensier',
      params: {
        changes: [
          { kind: 'SUBSCRIPTION', monthlyCents: 1_500 },
          { kind: 'LOAN', principalCents: 100_000, annualRateBp: 350, months: 24 },
        ],
      },
    });
    req.flush({ ...SCENARIOS[1], version: 2 });
    http.expectOne('/api/v1/scenarios').flush(SCENARIOS);
    await stable();
    expect(text(el.querySelector('#h-new')!)).toBe('Nouveau scénario');
    expect(value('sc-name')).toBe('');
  });

  it('modifier une catégorie : sens et montant repris ; annuler revient à la création', async () => {
    await open();
    button('Modifier Économe').click();
    await stable();
    const value = (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!.value;
    expect([value('sc-kind-0'), value('sc-category-0'), value('sc-direction-0'), value('sc-amount-0')]).toEqual(['CATEGORY', 'c1', 'less', '100,00']);
    button('Annuler la modification').click();
    await stable();
    expect(text(el.querySelector('#h-new')!)).toBe('Nouveau scénario');
    expect(el.querySelectorAll('fieldset')).toHaveLength(1);
  });

  it('version périmée (409) ⇒ message invitant à recharger', async () => {
    await open();
    button('Modifier Économe').click();
    await stable();
    button('Enregistrer les modifications').click();
    http.expectOne((r) => r.method === 'PATCH').flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('modifié entre-temps');
    expect(text(el.querySelector('#h-new')!)).toBe('Modifier « Économe »'); // saisie conservée
  });

  it('au plus 5 scénarios comparés', async () => {
    await open(Array.from({ length: 6 }, (_, i) => ({ ...SCENARIOS[0], id: `s${i}`, name: `S${i}` })));
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    for (const box of boxes.slice(0, 5)) box.click();
    await stable();
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, false, false, false, true]);
  });

  it('crée un scénario à plusieurs modifications (montants en centimes, taux en points de base)', async () => {
    await open();
    await type('sc-name', ' Projet ');
    await type('sc-amount-0', '12,99');
    button('Ajouter une modification').click();
    await stable();
    await type('sc-kind-1', 'CATEGORY');
    await type('sc-category-1', 'c1');
    await type('sc-amount-1', '100');
    button('Ajouter une modification').click();
    await stable();
    await type('sc-kind-2', 'LOAN');
    await type('sc-amount-2', '1000');
    await type('sc-rate-2', '3,5');
    await type('sc-months-2', '24');
    button('Enregistrer le scénario').click();

    const req = http.expectOne((r) => r.url === '/api/v1/scenarios' && r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Projet',
      params: {
        changes: [
          { kind: 'SUBSCRIPTION', monthlyCents: 1_299 },
          { kind: 'CATEGORY', categoryId: 'c1', monthlyDeltaCents: -10_000 },
          { kind: 'LOAN', principalCents: 100_000, annualRateBp: 350, months: 24 },
        ],
      },
    });
    req.flush(SCENARIOS[1]);
    http.expectOne('/api/v1/scenarios').flush(SCENARIOS);
    await stable();
    expect(el.querySelectorAll('fieldset')).toHaveLength(1); // formulaire remis à zéro
  });

  it('modification incomplète ⇒ aucun envoi, message d’erreur', async () => {
    await open();
    await type('sc-name', 'Projet');
    await type('sc-kind-0', 'CATEGORY');
    await type('sc-amount-0', '100'); // catégorie manquante
    button('Enregistrer le scénario').click();
    await stable();
    http.expectNone((r) => r.method === 'POST');
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Complétez le nom et chaque modification');
  });

  it('supprime un scénario puis recharge la liste', async () => {
    await open();
    button('Supprimer Économe').click();
    http.expectOne((r) => r.url === '/api/v1/scenarios/s1' && r.method === 'DELETE').flush(null);
    http.expectOne('/api/v1/scenarios').flush([SCENARIOS[1]]);
    await stable();
    expect([...el.querySelectorAll('ul[aria-label=Scénarios] strong')].map(text)).toEqual(['Dépensier']);
  });
});
