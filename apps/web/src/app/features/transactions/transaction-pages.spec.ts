import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CategoryDto, TrackingType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const COURANT: AccountDto = { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 };
const LIVRET: AccountDto = { id: 'a2', name: 'Livret', trackingType: TrackingType.WITH_INTEREST, openingDate: null, version: 1 };
const WALLET: AccountDto = { id: 'a3', name: 'Portefeuille', trackingType: TrackingType.NOT_TRACKED, openingDate: null, version: 1 };
const cat = (id: string, nameKey: string | null, parentId: string | null = null, name: string | null = null): CategoryDto => ({
  id,
  parentId,
  system: !name,
  nameKey,
  name,
  color: null,
  hidden: false,
  customName: null,
  archived: false,
});
const CATEGORIES = [
  cat('c1', 'groceries'),
  cat('c2', 'groceries.food', 'c1'),
  cat('c3', 'opening_balance'),
  cat('c4', 'transfer'),
  cat('c5', 'interest'),
  cat('c6', null, null, 'Animaux'),
  cat('c7', 'cash'),
];
const status = (code: number) => ({ status: code, statusText: String(code) });

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const stable = () => harness.fixture.whenStable();

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  input.dispatchEvent(new Event('blur'));
}

async function submit(): Promise<void> {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  await stable();
}

async function navigate(url: string): Promise<void> {
  if (harness) await harness.navigateByUrl(url);
  else harness = await RouterTestingHarness.create(url);
  el = harness.routeNativeElement!;
}

async function openExpense(accounts = [COURANT, WALLET]): Promise<void> {
  await navigate('/transactions/new');
  http.expectOne('/api/v1/accounts').flush(accounts);
  http.expectOne('/api/v1/categories').flush(CATEGORIES);
  await stable();
}

async function openAccounts(currentCents: number): Promise<void> {
  http.expectOne('/api/v1/accounts').flush([COURANT]);
  http.expectOne(`/api/v1/accounts/a1/balance?today=${today()}`).flush({ currentCents, forecastCents: currentCents });
  await stable();
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  harness = undefined!;
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Saisie d’une dépense', () => {
  it('3 champs (« 12,34 », catégorie, compte) ⇒ POST 1234 centimes daté du jour, puis solde mis à jour dans l’UI', async () => {
    await navigate('/accounts');
    await openAccounts(10000);
    expect(text('.balance')).toBe('Solde : 100,00 €');

    await openExpense([COURANT]);
    // Compte unique présélectionné.
    expect(el.querySelector<HTMLSelectElement>('#tx-account')!.value).toBe('a1');
    type('tx-amount', '12,34');
    type('tx-category', 'c1');
    await stable();
    type('tx-subcategory', 'c2');
    await submit();

    const req = http.expectOne('/api/v1/transactions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ accountId: 'a1', categoryId: 'c1', subcategoryId: 'c2', amountCents: 1234, date: today(), type: 'DEBIT' });
    req.flush({});
    await stable();

    expect(TestBed.inject(Router).url).toBe('/accounts');
    el = harness.routeNativeElement!;
    await openAccounts(10000 - 1234);
    expect(text('.balance')).toBe('Solde : 87,66 €');
  });

  it('détails facultatifs : revenu, autre date, libellé et notes', async () => {
    await openExpense();
    type('tx-amount', '1 500');
    type('tx-category', 'c6');
    type('tx-account', 'a1');
    type('tx-type', 'CREDIT');
    type('tx-date', '2026-01-31');
    type('tx-name', '  Prime ');
    type('tx-details', 'annuelle');
    await submit();

    expect(http.expectOne('/api/v1/transactions').request.body).toEqual({
      accountId: 'a1',
      categoryId: 'c6',
      amountCents: 150000,
      date: '2026-01-31',
      type: 'CREDIT',
      name: 'Prime',
      details: 'annuelle',
    });
  });

  const options = (id: string) => [...el.querySelectorAll(`#${id} option`)].map((o) => o.textContent?.trim());

  it('catégorie puis sous-catégorie : la seconde liste dépend de la première, catégories techniques absentes', async () => {
    await openExpense();
    expect(options('tx-category')).toEqual(['Sans catégorie', 'Animaux', 'Courses']);
    expect(el.querySelector('#tx-subcategory')).toBeNull();

    type('tx-category', 'c1');
    await stable();
    expect(options('tx-subcategory')).toEqual(['Aucune', 'Alimentaire']);

    // Catégorie sans sous-catégorie : la seconde liste disparaît.
    type('tx-category', 'c6');
    await stable();
    expect(el.querySelector('#tx-subcategory')).toBeNull();
  });

  it('catégorie et sous-catégorie facultatives : ni l’une ni l’autre n’est envoyée si vide', async () => {
    await openExpense();
    type('tx-amount', '5');
    type('tx-account', 'a1');
    await submit();
    const body = http.expectOne('/api/v1/transactions').request.body;
    expect(body).not.toHaveProperty('categoryId');
    expect(body).not.toHaveProperty('subcategoryId');
  });

  it('changer de catégorie efface la sous-catégorie choisie', async () => {
    await openExpense();
    type('tx-amount', '5');
    type('tx-account', 'a1');
    type('tx-category', 'c1');
    await stable();
    type('tx-subcategory', 'c2');
    type('tx-category', 'c6');
    await submit();
    const body = http.expectOne('/api/v1/transactions').request.body;
    expect(body).toMatchObject({ categoryId: 'c6' });
    expect(body).not.toHaveProperty('subcategoryId');
  });

  it.each(['0', '-5', '12,345', 'abc'])('montant « %s » refusé sans requête', async (amount) => {
    await openExpense();
    type('tx-amount', amount);
    type('tx-category', 'c1');
    type('tx-account', 'a1');
    await submit();

    http.expectNone('/api/v1/transactions');
    expect(el.querySelector('#tx-amount')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#tx-amount-hint')!.className).toBe('field-error');
  });

  it('champs requis manquants ⇒ erreurs reliées aux champs', async () => {
    await openExpense();
    await submit();
    http.expectNone('/api/v1/transactions');
    expect(el.querySelector('#tx-category')!.getAttribute('aria-invalid')).toBeNull();
    for (const id of ['tx-account']) {
      const field = el.querySelector(`#${id}`)!;
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector(`#${field.getAttribute('aria-describedby')}`)?.textContent).toContain('Choisissez');
    }
  });

  it('revenu sur un portefeuille NOT_TRACKED (422) ⇒ explication', async () => {
    await openExpense();
    type('tx-amount', '5');
    type('tx-category', 'c1');
    type('tx-account', 'a3');
    type('tx-type', 'CREDIT');
    await submit();
    http.expectOne('/api/v1/transactions').flush(null, status(422));
    await stable();

    expect(text('[role="alert"]')).toBe('Un portefeuille non suivi n’accepte que des dépenses.');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('accessibilité : chaque champ a un libellé, ordre de tabulation naturel', async () => {
    await openExpense();
    const controls = [...el.querySelectorAll('input, select, textarea')];
    expect(controls.map((c) => c.id).slice(0, 3)).toEqual(['tx-amount', 'tx-category', 'tx-account']);
    for (const c of controls) expect(el.querySelector(`label[for="${c.id}"]`), c.id).not.toBeNull();
    expect(el.querySelectorAll('[tabindex]').length).toBe(0);
    expect(el.querySelector('#tx-amount')!.getAttribute('inputmode')).toBe('decimal');
  });
});

describe('Virement', () => {
  async function openTransfer(): Promise<void> {
    await navigate('/transfers/new');
    http.expectOne('/api/v1/accounts').flush([COURANT, LIVRET, WALLET]);
    await stable();
  }

  it('POST /transfers en centimes puis retour aux comptes ; un portefeuille ne peut pas être débité', async () => {
    await openTransfer();
    const sources = [...el.querySelectorAll('#transfer-from option')].map((o) => o.textContent?.trim());
    expect(sources).toEqual(['Choisir un compte', 'Courant', 'Livret']);

    type('transfer-from', 'a1');
    type('transfer-to', 'a2');
    type('transfer-amount', '250,5');
    await submit();

    const req = http.expectOne('/api/v1/transfers');
    expect(req.request.body).toEqual({ fromAccountId: 'a1', toAccountId: 'a2', amountCents: 25050, date: today() });
    req.flush({});
    await stable();
    expect(TestBed.inject(Router).url).toBe('/accounts');
    http.expectOne('/api/v1/accounts').flush([]);
  });

  it('source = cible ⇒ erreur, aucune requête', async () => {
    await openTransfer();
    type('transfer-from', 'a1');
    type('transfer-to', 'a1');
    type('transfer-amount', '10');
    await submit();

    http.expectNone('/api/v1/transfers');
    expect(text('#transfer-to-error')).toContain('différent du compte débité');
    expect(el.querySelector('#transfer-to')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('vers un portefeuille NOT_TRACKED ⇒ explication du comptage en dépense « Espèces »', async () => {
    await openTransfer();
    expect(el.querySelector('#transfer-to-hint')).toBeNull();
    type('transfer-to', 'a3');
    await stable();
    expect(text('#transfer-to-hint')).toContain('double comptage');
  });

  it('accessibilité : chaque champ a un libellé', async () => {
    await openTransfer();
    for (const c of el.querySelectorAll('input, select')) {
      expect(el.querySelector(`label[for="${c.id}"]`), c.id).not.toBeNull();
    }
  });
});

describe('Jour du solde de départ (E30)', () => {
  const OPENED: AccountDto = { ...COURANT, openingDate: today() };
  const choose = (value: string) => {
    const radio = el.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };

  it('dépense le jour même : la question est posée et le choix est obligatoire puis envoyé', async () => {
    await openExpense([OPENED]);
    expect(text('legend')).toBe('Compter dans le solde ?');
    type('tx-amount', '5');
    type('tx-category', 'c1');
    await submit();
    http.expectNone('/api/v1/transactions');
    expect(el.querySelector('#tx-count-hint')!.className).toBe('field-error');

    choose('false');
    await submit();
    expect(http.expectOne('/api/v1/transactions').request.body).toMatchObject({ amountCents: 500, countInBalance: false });
  });

  it('dépense antérieure : pas de question, explication « hors solde », aucun drapeau envoyé', async () => {
    await openExpense([{ ...COURANT, openingDate: '2026-03-01' }]);
    type('tx-date', '2026-02-15');
    await stable();
    expect(el.querySelector('legend')).toBeNull();
    expect(text('#tx-before-opening')).toContain('sans changer le solde');
    type('tx-amount', '5');
    type('tx-category', 'c1');
    await submit();
    expect(http.expectOne('/api/v1/transactions').request.body).not.toHaveProperty('countInBalance');
  });

  it('virement le jour du solde de départ d’un des comptes : choix envoyé pour les deux jambes', async () => {
    await navigate('/transfers/new');
    http.expectOne('/api/v1/accounts').flush([COURANT, { ...LIVRET, openingDate: today() }]);
    await stable();
    type('transfer-from', 'a1');
    expect(el.querySelector('legend')).toBeNull();
    type('transfer-to', 'a2');
    type('transfer-amount', '10');
    await stable();
    expect(text('legend')).toBe('Compter dans le solde ?');
    choose('true');
    await submit();
    expect(http.expectOne('/api/v1/transfers').request.body).toMatchObject({ amountCents: 1000, countInBalance: true });
  });
});
