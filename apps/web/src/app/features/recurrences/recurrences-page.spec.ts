import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, centsToEuros, IntervalUnit, RecurrenceDto, TrackingType, TransactionType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';
import { frequencyLabel, nextDue } from './recurrences-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const COURANT: AccountDto = { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 };
const CATEGORIES = [
  { id: 'c1', parentId: null, system: true, nameKey: 'housing.rent', name: null, color: null },
  { id: 'c2', parentId: null, system: true, nameKey: 'transfer', name: null, color: null },
  { id: 'c3', parentId: null, system: true, nameKey: 'sport', name: null, color: null },
  { id: 'c4', parentId: 'c3', system: true, nameKey: 'sport.license', name: null, color: null },
];
const LOYER: RecurrenceDto = {
  id: 'r1',
  accountId: 'a1',
  interval: 1,
  unit: IntervalUnit.MONTH,
  startDate: '2026-01-31',
  endDate: null,
  template: { name: 'Loyer', amountCents: 80000, type: TransactionType.DEBIT, categoryId: 'c1', details: null, tagIds: [] },
  version: 1,
};

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const stable = () => harness.fixture.whenStable();
const dialog = () => el.querySelector('dialog')!;

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  input.dispatchEvent(new Event('blur'));
}

async function open(list: RecurrenceDto[]): Promise<void> {
  harness = await RouterTestingHarness.create('/recurrences');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/accounts').flush([COURANT]);
  http.expectOne('/api/v1/categories').flush(CATEGORIES);
  http.expectOne('/api/v1/recurrences').flush(list);
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

describe('Récurrences', () => {
  it('liste : montant signé, fréquence lisible, compte et catégorie, groupée par sens ; catégories réservées au serveur absentes du formulaire', async () => {
    const SALAIRE: RecurrenceDto = { ...LOYER, id: 'r2', template: { ...LOYER.template, name: 'Salaire', amountCents: 210000, type: TransactionType.CREDIT, categoryId: null } };
    await open([LOYER, SALAIRE]);
    expect([...el.querySelectorAll('.group-head')].map((h) => h.textContent?.trim())).toEqual(['Revenus', 'Dépenses']);
    const rows = [...el.querySelectorAll('.row')].map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('Salaire');
    expect(rows[0]).toContain('+2 100,00 €');
    expect(rows[0]).toContain('Courant · Sans catégorie');
    expect(rows[1]).toContain('Loyer');
    expect(rows[1]).toContain('Tous les mois depuis le 31 janv. 2026');
    expect(rows[1]).toContain('Courant · Loyer');
    expect(rows[1]).toContain('−800,00 €');
    expect(rows[1]).toMatch(/Prochaine échéance : \d{1,2} \S+ \d{4}/);
    // 2 100,00 − 800,00 par mois.
    expect(text('.summary .balance')).toBe('+1 300,00 €');
    const options = [...el.querySelectorAll('#rec-category option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Sans catégorie', 'Loyer', 'Sport']);
  });

  it('prochaine échéance : même ancrage que le serveur, null une fois terminée', () => {
    expect(nextDue(LOYER, '2026-02-01')).toBe('2026-02-28');
    expect(nextDue(LOYER, '2026-02-28')).toBe('2026-03-31');
    expect(nextDue({ ...LOYER, unit: IntervalUnit.WEEK, interval: 2 }, '2026-01-31')).toBe('2026-02-14');
    expect(nextDue({ ...LOYER, startDate: '2026-11-05' }, '2026-10-15')).toBe('2026-11-05');
    expect(nextDue({ ...LOYER, endDate: '2026-03-31' }, '2026-03-31')).toBeNull();
  });

  it('fréquence : singulier, pluriel, à venir, fin', () => {
    expect(frequencyLabel({ ...LOYER, unit: IntervalUnit.WEEK, interval: 2, endDate: '2026-12-31' }, '2026-10-15')).toBe(
      "Toutes les 2 semaines depuis le 31 janv. 2026 jusqu'au 31 déc. 2026",
    );
    expect(frequencyLabel({ ...LOYER, unit: IntervalUnit.DAY, startDate: '2026-11-05' }, '2026-10-15')).toBe('Tous les jours à partir du 5 nov. 2026');
  });

  it('catégorie puis sous-catégorie liées, facultatives', async () => {
    await open([]);
    expect(el.querySelector('#rec-subcategory')).toBeNull();
    type('rec-amount', '30');
    type('rec-account', 'a1');
    type('rec-category', 'c3');
    await stable();
    expect([...el.querySelectorAll('#rec-subcategory option')].map((o) => o.textContent?.trim())).toEqual(['Aucune', 'Licence']);
    type('rec-subcategory', 'c4');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const req = http.expectOne('/api/v1/recurrences');
    expect(req.request.body.template).toEqual({ categoryId: 'c3', subcategoryId: 'c4', amountCents: 3000, type: 'DEBIT' });
    req.flush(LOYER);
    await stable();
    http.expectOne('/api/v1/recurrences').flush([LOYER]);
    await stable();

    // Formulaire remis à zéro : sans catégorie, rien n'est envoyé.
    expect(el.querySelector('#rec-subcategory')).toBeNull();
    type('rec-amount', '30');
    type('rec-account', 'a1');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    expect(http.expectOne('/api/v1/recurrences').request.body.template).toEqual({ amountCents: 3000, type: 'DEBIT' });
  });

  it('création en modale : POST en centimes, modale fermée, puis liste relue', async () => {
    await open([]);
    expect(text('.empty')).toContain('Aucune récurrence.');
    el.querySelector<HTMLButtonElement>('.page-head .button')!.click();
    expect(dialog().open).toBe(true);
    type('rec-amount', '800');
    type('rec-category', 'c1');
    type('rec-account', 'a1');
    type('rec-interval', '2');
    type('rec-unit', 'WEEK');
    type('rec-end', '2026-12-31');
    type('rec-name', ' Loyer ');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();

    const req = http.expectOne('/api/v1/recurrences');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      accountId: 'a1',
      interval: 2,
      unit: 'WEEK',
      startDate: today(),
      endDate: '2026-12-31',
      template: { categoryId: 'c1', amountCents: 80000, type: 'DEBIT', name: 'Loyer' },
    });
    req.flush(LOYER);
    await stable();
    expect(dialog().open).toBe(false);
    http.expectOne('/api/v1/recurrences').flush([LOYER]);
  });

  it('sens « Revenu » via le sélecteur segmenté ⇒ CREDIT et signe « + »', async () => {
    await open([]);
    const revenu = [...el.querySelectorAll<HTMLButtonElement>('#rec-type button')].find((b) => b.textContent?.trim() === 'Revenu')!;
    revenu.click();
    await stable();
    expect(revenu.getAttribute('aria-pressed')).toBe('true');
    expect(text('.amount-sign')).toBe('+');
    type('rec-amount', '50');
    type('rec-account', 'a1');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    expect(http.expectOne('/api/v1/recurrences').request.body.template).toEqual({ amountCents: 5000, type: 'CREDIT' });
  });

  it('modification : modale préremplie, question à l’enregistrement, PATCH des seuls champs changés avec la portée choisie', async () => {
    await open([LOYER]);
    const edit = [...el.querySelectorAll<HTMLButtonElement>('.row button')].find((b) => b.textContent?.includes('Modifier'))!;
    expect(edit.textContent?.replace(/\s+/g, ' ').trim()).toBe('Modifier Loyer');
    edit.click();
    await stable();
    expect(dialog().open).toBe(true);
    expect(text('#rec-dialog-title')).toBe('Modifier la récurrence');
    expect(el.querySelector<HTMLInputElement>('#rec-amount')!.value).toBe(centsToEuros(80000));
    expect(el.querySelector<HTMLSelectElement>('#rec-category')!.value).toBe('c1');
    // Compte, fréquence et première échéance : rappelés, non modifiables.
    expect(el.querySelector('#rec-account')).toBeNull();
    expect(el.querySelector('#rec-start')).toBeNull();
    expect(text('dialog .muted')).toContain('Courant · Tous les mois depuis le 31 janv. 2026');

    type('rec-amount', '950');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    http.expectNone('/api/v1/recurrences/r1');
    expect(text('#rec-scope-title')).toBe('Appliquer la modification aussi aux échéances déjà passées ?');

    [...el.querySelectorAll<HTMLButtonElement>('.question button')].find((b) => b.textContent?.trim() === 'Aussi les précédentes')!.click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/v1/recurrences/r1' });
    expect(req.request.body).toEqual({ version: 1, scope: 'all', template: { amountCents: 95000 } });
    req.flush({ ...LOYER, version: 2 });
    await stable();
    expect(dialog().open).toBe(false);
    http.expectOne('/api/v1/recurrences').flush([LOYER]);
    await stable();
    expect(text('#rec-dialog-title')).toBe('Nouvelle récurrence');
  });

  it('modification d’une récurrence pas encore commencée : aucune question, prochaines échéances seulement', async () => {
    await open([{ ...LOYER, startDate: '2999-01-01' }]);
    [...el.querySelectorAll<HTMLButtonElement>('.row button')].find((b) => b.textContent?.includes('Modifier'))!.click();
    await stable();
    type('rec-name', 'Loyer appartement');
    type('rec-end', '2999-12-31');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    expect(el.querySelector('.question')).toBeNull();
    expect(http.expectOne({ method: 'PATCH', url: '/api/v1/recurrences/r1' }).request.body).toEqual({
      version: 1,
      scope: 'future',
      endDate: '2999-12-31',
      template: { name: 'Loyer appartement' },
    });
  });

  it('montant invalide ⇒ aucune requête', async () => {
    await open([]);
    type('rec-amount', '0');
    type('rec-category', 'c1');
    type('rec-account', 'a1');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    http.expectNone('/api/v1/recurrences');
    expect(el.querySelector('#rec-amount')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('suppression puis « Annuler » ⇒ restauration', async () => {
    await open([LOYER]);
    [...el.querySelectorAll<HTMLButtonElement>('.row button')].find((b) => b.textContent?.includes('Supprimer'))!.click();
    http.expectOne({ method: 'DELETE', url: '/api/v1/recurrences/r1' }).flush(null);
    http.expectOne('/api/v1/recurrences').flush([]);
    await stable();
    expect(text('[role="status"]')).toContain('Récurrence « Loyer » supprimée.');

    el.querySelector<HTMLButtonElement>('[role="status"] button')!.click();
    http.expectOne({ method: 'POST', url: '/api/v1/recurrences/r1/restore' }).flush(LOYER);
    http.expectOne('/api/v1/recurrences').flush([LOYER]);
    await stable();
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('accessibilité : chaque champ a un libellé', async () => {
    await open([]);
    for (const c of el.querySelectorAll('input, select')) expect(el.querySelector(`label[for="${c.id}"]`), c.id).not.toBeNull();
  });
});
