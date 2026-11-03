import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CashflowSimulationDto, DashboardPeriod, DashboardPreferencesDto, MonthlyStatDto, TrackingType, TransactionType, UpcomingOccurrenceDto } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { previousRange } from '../../core/date-range';
import { provideApiHttp } from '../../core/http';
import { QuickEntry } from '../../core/quick-entry';
import { today } from '../../core/today';
import { Notifications } from '../notifications/notifications';
import { dashboardRange } from './dashboard-period';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const account = (id: string, name: string, trackingType = TrackingType.NORMAL, openingDate: string | null = '2026-01-01'): AccountDto => ({ id, name, trackingType, openingDate, version: 1 });
const COURANT = account('a1', 'Courant');
const LIVRET = account('a2', 'Livret A', TrackingType.WITH_INTEREST);
const WALLET = account('a3', 'Portefeuille', TrackingType.NOT_TRACKED, null);
const PREFS: DashboardPreferencesDto = { period: 'THIS_MONTH', accountIds: null, curveAccountIds: [], curveTotal: true, hiddenBlocks: [], version: 1 };
const ACTIVITY: MonthlyStatDto[] = [{ month: '2026-11', incomeCents: 1, expenseCents: 1 }];
const rows = (incomeCents: number, expenseCents: number) => [{ categoryId: null, incomeCents, expenseCents }];
const occurrence = (recurrenceId: string, date: string): UpcomingOccurrenceDto => ({ recurrenceId, accountId: 'a1', date, name: 'Loyer', amountCents: 50000, type: TransactionType.DEBIT, categoryId: null });
const simulation = (id: string, name: string): CashflowSimulationDto => ({ id, name, params: {} as CashflowSimulationDto['params'], version: 1 });

interface Data {
  prefs?: DashboardPreferencesDto;
  accounts?: AccountDto[];
  /** Solde actuel et prévisionnel par compte suivi. */
  balances?: Record<string, [number, number]>;
  missingRate?: boolean;
  monthly?: MonthlyStatDto[];
  upcoming?: UpcomingOccurrenceDto[];
  /** `belowFloor` null : la simulation est terminée (422). */
  simulations?: { sim: CashflowSimulationDto; belowFloor: boolean | null }[];
  /** Période puis période précédente : [revenus, dépenses]. */
  stats?: [[number, number], [number, number]];
}

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const text = () => el.textContent!.replace(/\s+/g, ' ');
const stable = () => harness.fixture.whenStable();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
const checkbox = (label: string) => [...el.querySelectorAll('label.checkbox')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;
// Texte d'un élément, ses enfants séparés par une espace (le balisage n'en met pas entre eux).
const parts = (node: Element) => [...node.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()).join(' ');
const cards = () => [...el.querySelectorAll('li.card')].map(parts);
const steps = () => [...el.querySelectorAll('.checklist li')].map(parts);
const toggle = (box: HTMLInputElement, checked: boolean) => {
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
};

function flushStats(period: DashboardPeriod, [now, before]: [[number, number], [number, number]]): void {
  const range = dashboardRange(period, today());
  const prev = previousRange(range.from, range.to)!;
  http.expectOne(`/api/v1/stats/by-category?from=${range.from}&to=${range.to}`).flush(rows(...now));
  http.expectOne(`/api/v1/stats/by-category?from=${prev.from}&to=${prev.to}`).flush(rows(...before));
}

/** Répond à toutes les requêtes du chargement de la page. */
function respond(d: Data = {}): void {
  const accounts = d.accounts ?? [COURANT];
  const prefs = d.prefs ?? PREFS;
  http.expectOne('/api/v1/dashboard/preferences').flush(prefs);
  flushStats(prefs.period, d.stats ?? [[0, 0], [0, 0]]);
  http.expectOne('/api/v1/stats/monthly').flush(d.monthly ?? ACTIVITY);
  http.expectOne('/api/v1/accounts').flush(accounts);
  for (const a of accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED)) {
    const [currentCents, forecastCents] = d.balances?.[a.id] ?? [0, 0];
    http.expectOne(`/api/v1/accounts/${a.id}/balance?today=${today()}`).flush({ currentCents, forecastCents });
  }
  for (const a of accounts.filter((a) => a.trackingType === TrackingType.WITH_INTEREST)) {
    http.expectOne(`/api/v1/accounts/${a.id}/interest-rates`).flush({ rates: [], missingRate: d.missingRate ?? false });
  }
  http.expectOne(`/api/v1/dashboard/upcoming?days=7&today=${today()}`).flush(d.upcoming ?? []);
  http.expectOne('/api/v1/cashflow-simulations').flush((d.simulations ?? []).map((s) => s.sim));
  for (const { sim, belowFloor } of d.simulations ?? []) {
    const req = http.expectOne(`/api/v1/cashflow-simulations/${sim.id}/result?today=${today()}`);
    if (belowFloor === null) req.flush(null, { status: 422, statusText: 'Unprocessable' });
    else req.flush({ allowance: { belowFloor } });
  }
}

async function open(d: Data = {}): Promise<void> {
  harness = await RouterTestingHarness.create('/');
  el = harness.routeNativeElement!;
  respond(d);
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

describe('Tableau de bord : état vide', () => {
  it('sans compte : checklist de 3 étapes à faire, aucun chiffre', async () => {
    await open({ accounts: [], monthly: [] });

    expect(steps()).toEqual(['À faire Créer un compte', 'À faire Saisir le solde de départ', 'À faire Ajouter une première transaction']);
    expect(el.querySelector('.checklist a[href="/accounts"]')).not.toBeNull();
    expect(text()).not.toContain('Solde total');
  });

  it('étapes faites cochées ; la dernière ouvre la saisie rapide', async () => {
    await open({ accounts: [account('a1', 'Courant', TrackingType.NORMAL, null)], monthly: [] });
    expect(steps()).toEqual(['Fait Créer un compte', 'À faire Saisir le solde de départ', 'À faire Ajouter une première transaction']);

    button('Ajouter une première transaction').click();
    expect(TestBed.inject(QuickEntry).open()).toBe('transaction');
  });

  it('compte, solde de départ et transaction présents ⇒ plus de checklist, les chiffres s’affichent', async () => {
    await open({ balances: { a1: [1000, 1000] } });

    expect(el.querySelector('.checklist')).toBeNull();
    expect(text()).toContain('Solde total');
  });
});

describe('Tableau de bord : chiffres clés', () => {
  it('total des seuls comptes suivis (portefeuille exclu), prévisionnel affiché s’il diffère, montants depuis les centimes', async () => {
    await open({ accounts: [COURANT, LIVRET, WALLET], balances: { a1: [123456, 100000], a2: [50000, 50000] } });

    const all = cards();
    expect(all[0]).toContain('Solde total');
    expect(all[0]).toContain('1 734,56 €');
    expect(all[0]).toContain('Prévisionnel : 1 500,00 €');
    expect(all[1]).toContain('Courant');
    expect(all[1]).toContain('1 234,56 €');
    expect(all[2]).toContain('Livret A');
    expect(all[2]).not.toContain('Prévisionnel');
    expect(all.some((c) => c.includes('Portefeuille'))).toBe(false);
  });

  it('compte masqué ⇒ PUT des préférences, la carte disparaît, le total reste celui de tous les comptes', async () => {
    await open({ accounts: [COURANT, LIVRET], balances: { a1: [1000, 1000], a2: [2000, 2000] } });
    button('Personnaliser').click();
    await stable();

    toggle(checkbox('Livret A'), false);
    const put = http.expectOne({ method: 'PUT', url: '/api/v1/dashboard/preferences' });
    expect(put.request.body).toEqual({ ...PREFS, accountIds: ['a1'] });
    put.flush({ ...PREFS, accountIds: ['a1'], version: 2 });
    await stable();

    expect(cards().some((c) => c.includes('Livret A'))).toBe(false);
    expect(cards()[0]).toContain('30,00 €');
  });

  it('tout recocher ⇒ accountIds repasse à null ; bloc masqué ⇒ il disparaît (blocs d’une étape suivante conservés)', async () => {
    await open({ prefs: { ...PREFS, accountIds: ['a1'], hiddenBlocks: ['CATEGORY_DONUT'], version: 4 }, accounts: [COURANT, LIVRET], balances: { a1: [1, 1], a2: [2, 2] } });
    button('Personnaliser').click();
    await stable();

    expect(checkbox('Livret A').checked).toBe(false);
    toggle(checkbox('Livret A'), true);
    const first = http.expectOne({ method: 'PUT', url: '/api/v1/dashboard/preferences' });
    expect(first.request.body).toMatchObject({ accountIds: null, hiddenBlocks: ['CATEGORY_DONUT'], version: 4 });
    first.flush({ ...PREFS, accountIds: null, hiddenBlocks: ['CATEGORY_DONUT'], version: 5 });

    toggle(checkbox('Dépenses et revenus de la période'), false);
    const second = http.expectOne({ method: 'PUT', url: '/api/v1/dashboard/preferences' });
    expect(second.request.body).toMatchObject({ hiddenBlocks: ['CATEGORY_DONUT', 'PERIOD_SUMMARY'], version: 5 });
    second.flush({ ...PREFS, hiddenBlocks: ['CATEGORY_DONUT', 'PERIOD_SUMMARY'], version: 6 });
    await stable();

    expect(el.querySelector('#h-period')).toBeNull();
    expect(el.querySelector('#h-figures')).not.toBeNull();
  });

  it('préférences modifiées ailleurs (409) : message, puis « Recharger » relit tout', async () => {
    await open({ accounts: [COURANT, LIVRET], balances: { a1: [1, 1], a2: [2, 2] } });
    button('Personnaliser').click();
    await stable();

    toggle(checkbox('Courant'), false);
    http.expectOne({ method: 'PUT', url: '/api/v1/dashboard/preferences' }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('modifiées ailleurs');

    button('Recharger').click();
    respond({ prefs: { ...PREFS, version: 2 }, accounts: [COURANT, LIVRET], balances: { a1: [1, 1], a2: [2, 2] } });
    await stable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Tableau de bord : période', () => {
  it('dépenses, revenus et reste, avec l’écart à la période précédente (en centimes, sans pourcentage)', async () => {
    await open({ stats: [[200000, 12345], [150000, 20000]] });

    const [spent, income, rest] = cards().slice(-3);
    expect(spent).toContain('Dépenses 123,45 €');
    expect(spent).toContain('−76,55 € par rapport à la période précédente');
    expect(income).toContain('Revenus 2 000,00 €');
    expect(income).toContain('+500,00 € par rapport à la période précédente');
    expect(rest).toContain('Reste +1 876,55 €');
    expect(rest).toContain('+576,55 € par rapport à la période précédente');
    expect(el.querySelector('#h-period')!.textContent).toBe('Ce mois-ci');
  });

  it('changer la période enregistre la préférence puis relit les deux totaux', async () => {
    await open();

    const select = el.querySelector<HTMLSelectElement>('#dash-period')!;
    select.value = 'LAST_MONTH';
    select.dispatchEvent(new Event('change'));
    const put = http.expectOne({ method: 'PUT', url: '/api/v1/dashboard/preferences' });
    expect(put.request.body).toEqual({ ...PREFS, period: 'LAST_MONTH' });
    put.flush({ ...PREFS, period: 'LAST_MONTH', version: 2 });
    flushStats('LAST_MONTH', [[0, 5000], [0, 1000]]);
    await stable();

    expect(el.querySelector('#h-period')!.textContent).toBe('Mois dernier');
    expect(cards().at(-3)).toContain('Dépenses 50,00 €');
  });
});

describe('Tableau de bord : alertes', () => {
  it('aucune alerte ⇒ pas de bandeau', async () => {
    await open({ balances: { a1: [1000, 1000] } });

    expect(el.querySelector('#h-alerts')).toBeNull();
  });

  it('taux manquant, prévisionnel négatif, plancher, récurrences à venir et notifications non lues', async () => {
    TestBed.inject(Notifications).state.set({ unreadCount: 2, items: [] });
    await open({
      accounts: [COURANT, LIVRET],
      balances: { a1: [1000, -500], a2: [0, 0] },
      missingRate: true,
      upcoming: [occurrence('r1', '2026-11-05'), occurrence('r2', '2026-11-08')],
      simulations: [
        { sim: simulation('s1', 'Été'), belowFloor: true },
        { sim: simulation('s2', 'Hiver'), belowFloor: false },
        { sim: simulation('s3', 'Finie'), belowFloor: null },
      ],
    });

    const alerts = [...el.querySelectorAll('.alerts li')].map(parts);
    expect(alerts).toEqual([
      'Taux d’intérêt manquant pour « Livret A » : aucun intérêt ne sera crédité au 31/12. Définir le taux',
      'Le solde prévisionnel de « Courant » est négatif. Voir l’historique',
      'Simulation « Été » : le solde projeté passe sous le plancher. Voir la simulation',
      '2 récurrences dans les 7 prochains jours (prochaine : le 5 nov.). Voir les récurrences',
      '2 notifications non lues. Lire',
    ]);
    expect(el.querySelector('a[href="/notifications"]')).not.toBeNull();
  });
});

describe('Tableau de bord : actions rapides', () => {
  it('« + Transaction » et « Virement » ouvrent la saisie rapide', async () => {
    await open();

    const quick = TestBed.inject(QuickEntry);
    button('+ Transaction').click();
    expect(quick.open()).toBe('transaction');
    button('Virement').click();
    expect(quick.open()).toBe('transfer');
  });
});
