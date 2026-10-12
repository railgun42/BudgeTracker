import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, IntervalUnit, RecurrenceDto, TrackingType, TransactionType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const COURANT: AccountDto = { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, version: 1 };
const CATEGORIES = [
  { id: 'c1', parentId: null, system: true, nameKey: 'housing.rent', name: null, color: null },
  { id: 'c2', parentId: null, system: true, nameKey: 'transfer', name: null, color: null },
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
  it('liste : montant, fréquence, compte ; catégories réservées au serveur absentes du formulaire', async () => {
    await open([LOYER]);
    expect(text('.card p')).toBe('Loyer : −800,00 €, tous les 1 mois depuis le 2026-01-31 (Courant)');
    const options = [...el.querySelectorAll('#rec-category option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Choisir une catégorie', 'Loyer']);
  });

  it('création : POST en centimes, puis liste relue', async () => {
    await open([]);
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
    http.expectOne('/api/v1/recurrences').flush([LOYER]);
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
    el.querySelector<HTMLButtonElement>('.card button')!.click();
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
