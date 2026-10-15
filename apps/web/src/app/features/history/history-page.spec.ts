import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, CategoryDto, TrackingType, TransactionDto, TransactionType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { FILTER_DELAY_MS } from './history-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const ACCOUNTS: AccountDto[] = [
  { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 },
  { id: 'a2', name: 'Livret', trackingType: TrackingType.WITH_INTEREST, openingDate: null, version: 1 },
];
const CATEGORIES: CategoryDto[] = [
  { id: 'c1', parentId: null, system: true, nameKey: 'groceries', name: null, color: null, hidden: false, customName: null, archived: false },
  { id: 'c2', parentId: 'c1', system: true, nameKey: 'groceries.food', name: null, color: null, hidden: false, customName: null, archived: false },
  { id: 'c3', parentId: null, system: true, nameKey: 'transfer', name: null, color: null, hidden: false, customName: null, archived: false },
];
const TAGS = [{ id: 'g1', name: 'Vacances' }];
const tx = (id: string, over: Partial<TransactionDto> = {}): TransactionDto => ({
  id,
  accountId: 'a1',
  name: '',
  date: '2026-10-01',
  amountCents: 1234,
  type: TransactionType.DEBIT,
  details: null,
  categoryId: 'c2',
  tagIds: [],
  transferId: null,
  recurrenceId: null,
  countInBalance: null,
  attachment: null,
  version: 1,
  ...over,
});
const status = (code: number) => ({ status: code, statusText: String(code) });

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const rows = () => [...el.querySelectorAll('li.row')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
const stable = () => harness.fixture.whenStable();
/** Laisse passer le délai d'application automatique des filtres. */
const afterDelay = () => new Promise((r) => setTimeout(r, FILTER_DELAY_MS + 50)).then(stable);
const noListRequest = () => http.expectNone((r) => r.method === 'GET' && r.url === '/api/v1/transactions');

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

/** Prochaine requête GET /transactions (quels que soient ses paramètres). */
const listRequest = (): TestRequest => http.expectOne((r) => r.method === 'GET' && r.url === '/api/v1/transactions');
const params = (req: TestRequest) => Object.fromEntries(req.request.params.keys().map((k) => [k, req.request.params.get(k)]));

async function page(items: TransactionDto[], nextCursor: string | null = null): Promise<TestRequest> {
  const req = listRequest();
  req.flush({ items, nextCursor });
  await stable();
  return req;
}

/** Ouvre /history : références (comptes, catégories, tags) puis première page. */
async function open(items: TransactionDto[], nextCursor: string | null = null, accounts = ACCOUNTS): Promise<TestRequest> {
  harness = await RouterTestingHarness.create('/history');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/accounts').flush(accounts);
  http.expectOne('/api/v1/categories').flush(CATEGORIES);
  http.expectOne('/api/v1/tags').flush(TAGS);
  return page(items, nextCursor);
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Historique : liste et pagination', () => {
  it('affiche date, libellé, compte, catégorie « Parent › Enfant » et montant signé', async () => {
    const first = await open([
      tx('t1', { name: 'Marché' }),
      tx('t2', { type: TransactionType.CREDIT, amountCents: 50000, accountId: 'a2', categoryId: 'c1' }),
    ]);

    expect(params(first)).toEqual({});
    const [debit, credit] = rows();
    // Regroupement par jour (défaut) : la date lisible est dans l'en-tête du groupe.
    expect(text('.group-head')).toContain('1 oct. 2026');
    expect(debit).toContain('Marché');
    expect(debit).toContain('Courant · Courses › Alimentaire');
    expect(debit).toContain('−12,34 €'); // U+2212
    expect(credit).toContain('Livret · Courses');
    expect(credit).toContain('+500,00 €');
    expect(button('Charger plus')).toBeUndefined();
  });

  it('icône de la catégorie racine (sous-catégorie ⇒ parent), virement et sans catégorie à part', async () => {
    await open([tx('t1'), tx('t2', { categoryId: 'c1' }), tx('t3', { categoryId: 'c3' }), tx('t4', { categoryId: null })]);
    const icons = [...el.querySelectorAll('li.row .category-icon')];
    expect(icons.every((i) => i.getAttribute('aria-hidden') === 'true')).toBe(true);
    const [food, groceries, transfer, none] = icons.map((i) => i.querySelector('path')!.getAttribute('d'));
    expect(food).toBe(groceries);
    expect(new Set([groceries, transfer, none]).size).toBe(3);
  });

  it('« Charger plus » envoie le curseur et ajoute la page suivante sans remplacer la première', async () => {
    await open([tx('t1', { name: 'Un' })], 'CUR1');
    button('Charger plus')!.click();
    const next = await page([tx('t2', { name: 'Deux' })], null);

    expect(params(next)).toEqual({ cursor: 'CUR1' });
    expect(rows().map((r) => r.includes('Un') || r.includes('Deux'))).toEqual([true, true]);
    expect(rows()).toHaveLength(2);
    expect(button('Charger plus')).toBeUndefined();
  });

  it('liste vide : message et lien vers la saisie', async () => {
    await open([]);
    expect(text('ul.rows')).toContain('Aucune transaction');
  });
});

describe('Historique : regroupement', () => {
  it('par jour, semaine (lundi) ou mois, avec le solde signé de chaque groupe', async () => {
    await open([
      tx('t1', { name: 'Lundi', date: '2026-10-05' }),
      tx('t2', { name: 'Paie', date: '2026-10-04', type: TransactionType.CREDIT, amountCents: 50000 }),
      tx('t3', { name: 'Jeudi', date: '2026-10-01', amountCents: 1000 }),
      tx('t4', { name: 'Septembre', date: '2026-09-30', amountCents: 66 }),
    ]);
    const heads = () => [...el.querySelectorAll('.group-head')].map((h) => h.textContent!.replace(/\s+/g, ' ').trim());

    expect(heads()).toHaveLength(4);
    expect(heads()[0]).toBe('5 oct. 2026 Solde −12,34 €');

    button('Semaine')!.click();
    await stable();
    expect(heads()).toEqual(['Semaine du 5 oct. 2026 Solde −12,34 €', 'Semaine du 28 sept. 2026 Solde +489,34 €']);
    expect(rows()[0]).toContain('5 oct. 2026 · Courant');

    button('Mois')!.click();
    await stable();
    expect(heads()).toEqual(['octobre 2026 Solde +477,66 €', 'septembre 2026 Solde −0,66 €']);
    expect(rows()).toHaveLength(4);
  });

  it('dernier groupe incomplet tant qu’il reste une page : « Solde partiel »', async () => {
    await open([tx('t1', { date: '2026-10-05' }), tx('t2', { date: '2026-10-04' })], 'CUR1');
    const heads = [...el.querySelectorAll('.group-head')].map((h) => h.textContent!);
    expect(heads[0]).not.toContain('partiel');
    expect(heads[1]).toContain('Solde partiel');
  });
});

describe('Historique : filtres', () => {
  it('filtres appliqués dès qu’ils changent, en une seule requête après le délai ; conservés par « Charger plus », effacés ensuite', async () => {
    await open([tx('t1')]);
    expect(button('Filtrer')).toBeUndefined();
    type('f-from', '2026-09-01');
    type('f-to', '2026-09-30');
    type('f-account', 'a2');
    type('f-category', 'c1');
    await stable();
    type('f-subcategory', 'c2'); // la sous-catégorie choisie est envoyée comme categoryId
    type('f-tag', 'g1');
    noListRequest(); // pas de requête par champ modifié
    await afterDelay();

    const filtered = await page([tx('t2', { name: 'Filtrée' })], 'CUR1');
    const expected = { from: '2026-09-01', to: '2026-09-30', accountId: 'a2', categoryId: 'c2', tagId: 'g1' };
    expect(params(filtered)).toEqual(expected);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Filtrée');

    // « Charger plus » pendant le délai : la page suivante garde les filtres de la recherche en cours…
    type('f-account', 'a1');
    button('Charger plus')!.click();
    expect(params(await page([]))).toEqual({ ...expected, cursor: 'CUR1' });
    // … puis le nouveau filtre s'applique et repart de la première page.
    await afterDelay();
    expect(params(await page([]))).toEqual({ ...expected, accountId: 'a1' });

    button('Effacer les filtres')!.click();
    expect(params(await page([]))).toEqual({});
    await afterDelay();
    noListRequest(); // l'effacement ne relance pas une seconde recherche
  });

  it('filtre « Sans catégorie » ⇒ categoryId=none ; une transaction sans catégorie l’affiche', async () => {
    await open([tx('t1')]);
    type('f-category', 'none');
    await afterDelay();
    const req = await page([tx('t2', { categoryId: null })]);
    expect(params(req)).toEqual({ categoryId: 'none' });
    expect(rows()[0]).toContain('Courant · Sans catégorie');
    expect(el.querySelector('#f-subcategory')).toBeNull();
  });

  it('catégorie seule ⇒ son id ; changer de catégorie efface la sous-catégorie', async () => {
    await open([tx('t1')]);
    type('f-category', 'c1');
    await afterDelay();
    expect(params(await page([]))).toEqual({ categoryId: 'c1' });

    type('f-subcategory', 'c2');
    await afterDelay();
    expect(params(await page([]))).toEqual({ categoryId: 'c2' });

    type('f-category', 'c3'); // « Virement » n'a pas d'enfant : plus de liste de sous-catégories
    await afterDelay();
    expect(params(await page([]))).toEqual({ categoryId: 'c3' });
    expect(el.querySelector('#f-subcategory')).toBeNull();
  });

  it('effacer un filtre appliqué le retire aussitôt de la recherche', async () => {
    await open([tx('t1')]);
    type('f-tag', 'g1');
    await afterDelay();
    expect(params(await page([]))).toEqual({ tagId: 'g1' });
    type('f-tag', '');
    await afterDelay();
    expect(params(await page([]))).toEqual({});
  });

  it('options : comptes, catégories racines triées, sous-catégories de la catégorie choisie, tags', async () => {
    await open([]);
    const options = (id: string) => [...el.querySelectorAll(`#${id} option`)].map((o) => o.textContent!.trim());
    expect(options('f-account')).toEqual(['Tous les comptes', 'Courant', 'Livret']);
    expect(options('f-category')).toEqual(['Toutes les catégories', 'Sans catégorie', 'Courses', 'Virement']);
    expect(el.querySelector('#f-subcategory')).toBeNull();
    expect(options('f-tag')).toEqual(['Tous les tags', 'Vacances']);

    type('f-category', 'c1');
    await stable();
    expect(options('f-subcategory')).toEqual(['Toutes les sous-catégories', 'Alimentaire']);
    expect(el.querySelector('label[for="f-subcategory"]')?.textContent).toBe('Sous-catégorie');
    await afterDelay();
    await page([]);
  });
});

describe('Historique : suppression et annulation', () => {
  it('Supprimer ⇒ DELETE, ligne retirée, bannière « Annuler » ⇒ restore puis liste relue', async () => {
    await open([tx('t1', { name: 'Marché' }), tx('t2', { name: 'Loyer' })]);
    button('Supprimer Marché')!.click();
    const del = http.expectOne('/api/v1/transactions/t1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, status(204));
    await stable();

    expect(rows()).toHaveLength(1);
    expect(text('[role="status"]')).toContain('Transaction « Marché » supprimée');

    button('Annuler')!.click();
    const restore = http.expectOne('/api/v1/transactions/t1/restore');
    expect(restore.request.method).toBe('POST');
    restore.flush(tx('t1', { name: 'Marché', version: 3 }));
    await page([tx('t1', { name: 'Marché', version: 3 }), tx('t2', { name: 'Loyer' })]);

    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain('Marché');
  });

  it('jambe de virement : pas de « Modifier », supprimer retire les deux jambes', async () => {
    await open([
      tx('d1', { name: 'Épargne', transferId: 'tr1', categoryId: 'c3' }),
      tx('c1', { name: 'Épargne', transferId: 'tr1', categoryId: 'c3', accountId: 'a2', type: TransactionType.CREDIT }),
      tx('t3', { name: 'Pain' }),
    ]);
    expect(rows()[0]).toContain('Virement');
    expect(button('Modifier Épargne')).toBeUndefined();

    button('Supprimer Épargne')!.click();
    http.expectOne('/api/v1/transactions/d1').flush(null, status(204));
    await stable();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Pain');
  });
});

describe('Historique : modification et conflit 409', () => {
  it('Modifier ⇒ formulaire prérempli, PATCH avec la version, ligne mise à jour', async () => {
    await open([tx('t1', { name: 'Marché', version: 4 })]);
    button('Modifier Marché')!.click();
    await stable();
    expect(el.querySelector<HTMLInputElement>('#e-amount')!.value).toBe('12,34');

    type('e-amount', '20,5');
    type('e-name', ' Marché bio ');
    button('Enregistrer')!.click();
    const req = http.expectOne('/api/v1/transactions/t1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ version: 4, amountCents: 2050, name: 'Marché bio', date: '2026-10-01' });
    req.flush(tx('t1', { name: 'Marché bio', amountCents: 2050, version: 5 }));
    await stable();

    expect(el.querySelector('#e-amount')).toBeNull();
    expect(rows()[0]).toContain('Marché bio');
    expect(rows()[0]).toContain('−20,50 €');
  });

  it('date déplacée sur le jour du solde de départ (E30) : choix obligatoire puis envoyé', async () => {
    await open([tx('t1', { name: 'Marché', date: '2026-10-05' })], null, [{ ...ACCOUNTS[0], openingDate: '2026-10-01' }]);
    button('Modifier Marché')!.click();
    await stable();
    // Date inchangée, même au jour J : pas de question (l'API ne la redemande pas).
    expect(el.querySelector('legend')).toBeNull();
    type('e-date', '2026-10-01');
    await stable();
    expect(el.querySelector('legend')?.textContent).toBe('Compter dans le solde ?');
    expect(button('Enregistrer')!.disabled).toBe(true);

    const radio = el.querySelector<HTMLInputElement>('input[type="radio"][value="false"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await stable();
    button('Enregistrer')!.click();
    expect(http.expectOne('/api/v1/transactions/t1').request.body).toEqual({
      version: 1,
      amountCents: 1234,
      name: 'Marché',
      date: '2026-10-01',
      countInBalance: false,
    });
  });

  it('montant invalide ⇒ enregistrement impossible', async () => {
    await open([tx('t1', { name: 'Marché' })]);
    button('Modifier Marché')!.click();
    await stable();
    type('e-amount', '0');
    await stable();
    expect(button('Enregistrer')!.disabled).toBe(true);
    expect(el.querySelector('#e-amount')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('409 ⇒ message clair et « Recharger » qui relit la première page', async () => {
    await open([tx('t1', { name: 'Marché' })], 'CUR1');
    button('Modifier Marché')!.click();
    await stable();
    button('Enregistrer')!.click();
    http.expectOne('/api/v1/transactions/t1').flush(null, status(409));
    await stable();

    expect(text('[role="alert"]')).toContain('modifiée depuis un autre écran');
    button('Recharger')!.click();
    const reloaded = await page([tx('t1', { name: 'Marché', version: 2 })]);

    expect(params(reloaded)).toEqual({});
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('#e-amount')).toBeNull();
  });
});

describe('Historique : accessibilité', () => {
  it('chaque champ a un libellé, boutons explicites, aucun tabindex positif', async () => {
    await open([tx('t1', { name: 'Marché' })]);
    button('Modifier Marché')!.click();
    await stable();
    for (const control of el.querySelectorAll('input, select')) {
      expect(el.querySelector(`label[for="${control.id}"]`), control.id).not.toBeNull();
    }
    expect([...el.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0)).toEqual([]);
  });
});
