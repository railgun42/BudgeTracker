import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  AccountDto,
  CashflowDto,
  CashflowSimulationDto,
  IntervalUnit,
  RecurrenceDto,
  TrackingType,
  TransactionType,
} from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';
import { RECALC_DELAY_MS } from './cashflow-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const ACCOUNTS: AccountDto[] = [
  { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 },
  { id: 'a2', name: 'Portefeuille', trackingType: TrackingType.NOT_TRACKED, openingDate: null, version: 1 },
  { id: 'a3', name: 'Livret', trackingType: TrackingType.WITH_INTEREST, openingDate: null, version: 1 },
];
const recurrence = (id: string, accountId: string, name: string, amountCents: number, type = TransactionType.DEBIT): RecurrenceDto => ({
  id,
  accountId,
  interval: 1,
  unit: IntervalUnit.MONTH,
  startDate: '2026-01-05',
  endDate: null,
  template: { name, amountCents, type, categoryId: null, details: null, tagIds: [] },
  version: 1,
});
const RECURRENCES = [recurrence('r1', 'a1', 'Loyer', 70_000), recurrence('r2', 'a1', 'Salaire', 200_000, TransactionType.CREDIT), recurrence('r3', 'a3', 'Épargne', 5_000)];
const TODAY = today();
const day = (d: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const RESULT: CashflowDto = {
  startDate: TODAY,
  endDate: '2030-03-31',
  startBalanceCents: 100_000,
  endBalanceCents: 50_000,
  creditCents: 400_000,
  debitCents: 450_000,
  items: [
    { source: 'RECURRENCE', id: 'r1', name: 'Loyer', type: TransactionType.DEBIT, amountCents: 70_000, included: true, occurrences: 2, totalCents: 140_000 },
    { source: 'RECURRENCE', id: 'r2', name: 'Salaire', type: TransactionType.CREDIT, amountCents: 200_000, included: true, occurrences: 2, totalCents: 400_000 },
    { source: 'ONE_OFF', id: null, name: 'Vacances', type: TransactionType.DEBIT, amountCents: 1_234, included: true, occurrences: 1, totalCents: 1_234 },
  ],
  points: [
    { date: TODAY, balanceCents: 100_000 },
    { date: '2030-03-31', balanceCents: 50_000 },
  ],
  allowance: {
    floorCents: 20_000,
    period: 'MONTH',
    periods: 3,
    current: { index: 1, from: '2030-02-01', to: '2030-02-28' },
    periodCents: 12_500,
    spentCents: 5_000,
    remainingCents: 7_500,
    belowFloor: false,
  },
};
const SAVED: CashflowSimulationDto = {
  id: 's1',
  name: 'Été',
  version: 3,
  params: {
    accountIds: ['a1'],
    startDate: '2026-01-01',
    endDate: '2030-03-31',
    excludedRecurrenceIds: ['r1'],
    oneOffs: [{ name: 'Vacances', type: TransactionType.DEBIT, amountCents: 1_234, date: '2030-02-10' }],
    floor: { floorCents: 20_000, period: 'MONTH' },
  },
};

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
const text = (node: Element) => node.textContent!.replace(/\s+/g, ' ').trim();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label)!;
const checkbox = (label: string) => [...el.querySelectorAll('label')].find((l) => text(l).startsWith(label))!.querySelector('input')!;
const afterDelay = () => new Promise((r) => setTimeout(r, RECALC_DELAY_MS + 50)).then(stable);
const cashflowCall = () => http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/simulations/cashflow');

async function type(id: string, value: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  await stable();
}

async function open(saved: CashflowSimulationDto[] = []): Promise<void> {
  harness = await RouterTestingHarness.create('/simulations');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/accounts').flush(ACCOUNTS);
  http.expectOne('/api/v1/recurrences').flush(RECURRENCES);
  http.expectOne('/api/v1/cashflow-simulations').flush(saved);
  await stable();
}

/** Compte courant coché, fin au 31/03/2030, une ponctuelle « Vacances » de 12,34 €, plancher 200 € par mois. */
async function fill(): Promise<void> {
  checkbox('Courant').click();
  await stable();
  await type('cf-end', '2030-03-31');
  button('Ajouter une dépense ou un revenu ponctuel').click();
  await stable();
  await type('cf-o-name-0', 'Vacances');
  await type('cf-o-amount-0', '12,34');
  await type('cf-o-date-0', '2030-02-10');
  button('Ajouter la ponctuelle').click();
  await stable();
  await type('cf-floor', '200');
}

async function calculate(): Promise<TestRequest> {
  await fill();
  button('Calculer').click();
  const req = cashflowCall();
  return req;
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Simulation de trésorerie', () => {
  it('propose les comptes avec solde et les récurrences des seuls comptes cochés', async () => {
    await open();
    const accounts = el.querySelectorAll('fieldset')[0];
    expect([...accounts.querySelectorAll('label')].map(text)).toEqual(['Courant', 'Livret']);
    expect(el.textContent).toContain('Aucune récurrence sur les comptes choisis.');

    checkbox('Courant').click();
    await stable();
    const recurrences = el.querySelectorAll('fieldset')[1];
    expect([...recurrences.querySelectorAll('label')].map(text)).toEqual([
      'Loyer : −700,00 €, tous les 1 mois',
      'Salaire : +2 000,00 €, tous les 1 mois',
    ]);
    expect([...recurrences.querySelectorAll<HTMLInputElement>('input')].every((i) => i.checked)).toBe(true);
  });

  it('calcule : « 12,34 » envoie 1234 ; affiche solde au jour X, enveloppe, courbe et détail', async () => {
    await open();
    const req = await calculate();
    expect(req.request.body).toEqual({
      accountIds: ['a1'],
      startDate: TODAY,
      endDate: '2030-03-31',
      excludedRecurrenceIds: [],
      extraRecurrences: [],
      oneOffs: [{ name: 'Vacances', type: 'DEBIT', amountCents: 1234, date: '2030-02-10' }],
      floor: { floorCents: 20_000, period: 'MONTH' },
      today: TODAY,
    });
    req.flush(RESULT);
    await stable();

    expect(text(el.querySelector('.end')!)).toBe('Solde au 31 mars 2030 : +500,00 €');
    expect([...el.querySelectorAll('.stat')].map((c) => [...c.children].map(text).join(' '))).toEqual([`Départ le ${day(TODAY)} +1 000,00 €`, 'Revenus +4 000,00 €', 'Dépenses −4 500,00 €']);
    expect([...el.querySelectorAll('.allowance dt, .allowance dd')].map(text)).toEqual([
      'Enveloppe du mois (du 1 févr. 2030 au 28 févr. 2030)',
      '125,00 €',
      'Déjà dépensé',
      '50,00 €',
      'Reste à dépenser',
      '75,00 €',
    ]);
    expect(el.textContent).toContain('Période 2 sur 3');
    // Jauge : 75 € restants sur 125 €.
    expect(el.querySelector<HTMLElement>('.gauge-fill')!.style.width).toBe('60%');
    expect(el.textContent).toContain("60 % de l'enveloppe reste à dépenser");
    expect(el.querySelectorAll('app-projection-chart polyline')).toHaveLength(1);
    expect(text(el.querySelector('app-projection-chart .floor-label')!)).toBe('Plancher 200,00 €');
    expect(text(el.querySelector('app-projection-chart .legend')!)).toBe('Solde projeté');
    expect([...el.querySelectorAll('table.items tbody tr')].map((tr) => [...tr.children].map(text).join(' | '))).toEqual([
      'Loyer | Récurrence | 2 | −1 400,00 €',
      'Salaire | Récurrence | 2 | +4 000,00 €',
      'Vacances | Ponctuelle simulée | 1 | −12,34 €',
    ]);
  });

  it('décocher une récurrence recalcule aussitôt, sans elle', async () => {
    await open();
    (await calculate()).flush(RESULT);
    await stable();

    checkbox('Loyer').click();
    const req = cashflowCall();
    expect(req.request.body.excludedRecurrenceIds).toEqual(['r1']);
    req.flush({ ...RESULT, items: [{ ...RESULT.items[0], included: false }, ...RESULT.items.slice(1)] });
    await stable();
    expect(text(el.querySelector('table.items tbody tr th')!)).toBe('Loyer (décochée, hors solde)');

    checkbox('Loyer').click();
    expect(cashflowCall().request.body.excludedRecurrenceIds).toEqual([]);
  });

  it('plancher non atteignable : alerte', async () => {
    await open();
    (await calculate()).flush({ ...RESULT, allowance: { ...RESULT.allowance!, periodCents: 0, remainingCents: -5_000, belowFloor: true } });
    await stable();
    expect(text(el.querySelector('[role=alert]')!)).toContain('passe sous le plancher de 200,00 €');
  });

  it('saisie incomplète : rien n’est envoyé', async () => {
    await open();
    button('Calculer').click();
    await stable();
    expect(text(el.querySelector('[role=alert]')!)).toContain('Choisissez au moins un compte');
    expect(el.querySelector('#cf-end')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('enregistre une simulation, puis l’enregistre à nouveau avec sa version', async () => {
    await open();
    await fill();
    await type('cf-name', 'Été');
    button('Enregistrer la simulation').click();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/v1/cashflow-simulations');
    expect(post.request.body).toEqual({
      name: 'Été',
      today: TODAY,
      params: expect.objectContaining({ accountIds: ['a1'], endDate: '2030-03-31', floor: { floorCents: 20_000, period: 'MONTH' } }),
    });
    post.flush({ ...SAVED, version: 1 });
    http.expectOne('/api/v1/cashflow-simulations').flush([SAVED]);
    await stable();

    button('Enregistrer les modifications').click();
    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url === '/api/v1/cashflow-simulations/s1');
    expect(patch.request.body.version).toBe(1);
    patch.flush({ message: 'conflit' }, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(text(el.querySelector('[role=alert]')!)).toContain('modifiée entre-temps');
  });

  it('rouvre une simulation sauvegardée : formulaire prérempli et suivi avec les dépenses réelles', async () => {
    await open([SAVED]);
    button('Ouvrir Été').click();
    const req = http.expectOne((r) => r.url === '/api/v1/cashflow-simulations/s1/result');
    expect(req.request.params.get('today')).toBe(TODAY);
    req.flush(RESULT);
    await stable();

    expect(el.querySelector('h2:not([id])')!.textContent).toContain('Simulation « Été »');
    expect(el.querySelector<HTMLInputElement>('#cf-end')!.value).toBe('2030-03-31');
    expect(text(el.querySelector('.sim-row')!)).toContain('Vacances : −12,34 €, le 10 févr. 2030');
    button('Modifier la ponctuelle 1').click();
    await stable();
    expect(el.querySelector<HTMLInputElement>('#cf-o-amount-0')!.value).toBe('12,34');
    expect(el.querySelector<HTMLInputElement>('#cf-floor')!.value).toBe('200,00');
    expect(checkbox('Courant').checked).toBe(true);
    expect(checkbox('Loyer').checked).toBe(false);
    expect(text(el.querySelector('.allowance dd:last-child')!)).toBe('75,00 €');

    // Début passé : un recalcul repart d'aujourd'hui (l'API refuse un début antérieur).
    checkbox('Salaire').click();
    const recalc = cashflowCall();
    expect(recalc.request.body).toMatchObject({ startDate: TODAY, excludedRecurrenceIds: ['r1', 'r2'] });
    recalc.flush(RESULT);
  });

  it('simulation terminée : message clair', async () => {
    await open([SAVED]);
    button('Ouvrir Été').click();
    http.expectOne((r) => r.url === '/api/v1/cashflow-simulations/s1/result').flush({}, { status: 422, statusText: 'Unprocessable' });
    await stable();
    expect(text(el.querySelector('[role=alert]')!)).toContain('simulation terminée');
  });

  it('supprime une simulation sauvegardée', async () => {
    await open([SAVED]);
    button('Supprimer Été').click();
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/v1/cashflow-simulations/s1').flush(null);
    http.expectOne('/api/v1/cashflow-simulations').flush([]);
    await stable();
    expect(el.textContent).toContain('Aucune simulation sauvegardée.');
  });

  it('l’ancienne adresse /simulations/tresorerie mène à la page', async () => {
    harness = await RouterTestingHarness.create('/simulations/tresorerie');
    http.expectOne('/api/v1/accounts').flush(ACCOUNTS);
    http.expectOne('/api/v1/recurrences').flush(RECURRENCES);
    http.expectOne('/api/v1/cashflow-simulations').flush([]);
    await stable();
    expect(TestBed.inject(Router).url).toBe('/simulations');
    expect(harness.routeNativeElement!.querySelector('h1')!.textContent).toBe('Simulation de trésorerie');
  });

  it('formulaires accessibles : chaque champ a un libellé', async () => {
    await open();
    checkbox('Courant').click();
    await stable();
    button('Ajouter une récurrence simulée').click();
    button('Ajouter une dépense ou un revenu ponctuel').click();
    await stable();
    const fields = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form input, form select')];
    expect(fields.length).toBeGreaterThan(15);
    for (const f of fields) {
      const labelled = f.closest('label') ?? (f.id && el.querySelector(`label[for="${f.id}"]`));
      expect(labelled, f.outerHTML).toBeTruthy();
    }
    expect(text(el.querySelector('#cf-x-title')!)).toBe('Récurrence simulée 1');
  });

  it('recalcule seul quand un paramètre change après un premier calcul', async () => {
    await open();
    (await calculate()).flush(RESULT);
    await stable();
    await afterDelay();

    await type('cf-floor', '300');
    await afterDelay();
    const req = cashflowCall();
    expect(req.request.body.floor).toEqual({ floorCents: 30_000, period: 'MONTH' });
    req.flush(RESULT);
  });

  it('modale de ligne simulée : montant invalide refusé, modification enregistrée dans la ligne', async () => {
    await open();
    button('Ajouter une récurrence simulée').click();
    await stable();
    await type('cf-x-name-0', 'Netflix');
    await type('cf-x-amount-0', '0');
    button('Ajouter la récurrence simulée').click();
    await stable();
    expect(el.querySelector('#cf-x-amount-0')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelectorAll('.sim-row')).toHaveLength(0);

    await type('cf-x-amount-0', '13,49');
    button('Ajouter la récurrence simulée').click();
    await stable();
    expect(el.querySelector('dialog[open]')).toBeNull();
    expect(text(el.querySelector('.sim-row')!)).toContain('Netflix : −13,49 €,');

    button('Modifier la récurrence simulée 1').click();
    await stable();
    button('Revenu').click();
    button('Enregistrer la récurrence simulée').click();
    await stable();
    expect(text(el.querySelector('.sim-row')!)).toContain('Netflix : +13,49 €,');
  });

  it('assistant : étapes accessibles, retour à l’étape à compléter', async () => {
    await open();
    const shown = () => [...el.querySelectorAll<HTMLElement>('.step')].findIndex((s) => !s.hidden);
    expect(el.querySelector('.steps [aria-current=step]')!.textContent).toContain('Période');
    button('Suivant').click();
    await stable();
    expect(shown()).toBe(1);
    button('3Plancher').click();
    await stable();
    expect(shown()).toBe(2);
    expect(el.querySelector('.steps [aria-current=step]')!.textContent).toContain('Plancher');

    button('Calculer').click();
    await stable();
    expect(shown()).toBe(0);
  });
});
