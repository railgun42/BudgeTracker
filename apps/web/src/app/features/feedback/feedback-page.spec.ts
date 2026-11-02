import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FeedbackDto, FeedbackType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';

const USER = { id: 'u1', email: 'a@example.com', name: 'A', lastConnection: null, role: 'USER' };
const URL = '/api/v1/feedback';
const fb = (id: string, over: Partial<FeedbackDto> = {}): FeedbackDto => ({
  id,
  type: FeedbackType.IDEA,
  message: 'Un mode sombre',
  status: 'NEW',
  createdAt: '2026-10-15T08:00:00.000Z',
  treatedAt: null,
  ...over,
});

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const submit = () => el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
const items = () => [...el.querySelectorAll('ul[aria-label="Mes retours"] li')];

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLTextAreaElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
const pick = (value: string) => el.querySelector<HTMLInputElement>(`#feedback-type-${value}`)!.click();
const filterBy = (label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Filtrer par statut"] button')].find((b) => b.textContent!.includes(label))!.click();

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
  harness = await RouterTestingHarness.create('/feedback');
  el = harness.routeNativeElement!;
  http.expectOne(URL).flush([fb('f1', { type: FeedbackType.PROBLEM, message: '<b>gras</b>', status: 'TREATED', treatedAt: '2026-10-15T09:00:00.000Z' })]);
  await stable();
});

afterEach(() => http.verify());

describe('Donner mon avis', () => {
  it('liste ses retours en texte brut (HTML jamais interprété), avec type et statut', () => {
    expect(items()).toHaveLength(1);
    expect(clean(items()[0].querySelector('p')?.textContent)).toMatch(/^Problème · \d{1,2} oct\. 2026.+ · Traité$/);
    expect(items()[0].querySelector('.badge-neutral')?.textContent?.trim()).toBe('Traité');
    expect(items()[0].querySelector('.message')?.textContent).toBe('<b>gras</b>');
    expect(items()[0].querySelector('b')).toBeNull();
  });

  it('message obligatoire : aucune requête, champ signalé', async () => {
    type('feedback-message', '   ');
    submit();
    await stable();
    expect(el.querySelector('#feedback-message')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#feedback-message')?.getAttribute('maxlength')).toBe('2000');
  });

  it('envoie type et message rogné, puis recharge la liste', async () => {
    pick('IDEA');
    expect(el.querySelector<HTMLInputElement>('#feedback-type-IDEA')!.checked).toBe(true);
    type('feedback-message', '  Un mode sombre  ');
    await stable();
    expect(clean(el.querySelector('#feedback-message-hint')?.textContent)).toBe('Obligatoire, 18 / 2000 caractères.');
    submit();
    const req = http.expectOne({ method: 'POST', url: URL });
    expect(req.request.body).toEqual({ type: 'IDEA', message: 'Un mode sombre' });
    await stable();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(clean(el.querySelector('button[type="submit"]')?.textContent)).toBe('Envoi en cours…');
    req.flush(fb('f2'));
    http.expectOne(URL).flush([fb('f2'), fb('f1')]);
    await stable();
    expect(items()).toHaveLength(2);
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Merci, votre message a été envoyé.');
    expect(el.querySelector('[aria-live] .alert-success.confirm-pop')).not.toBeNull();
    expect(items()[0].classList).toContain('confirm-pop');
    expect(items()[1].classList).not.toContain('confirm-pop');
    expect((el.querySelector('#feedback-message') as HTMLTextAreaElement).value).toBe('');
  });

  it('429 : limite expliquée', async () => {
    type('feedback-message', 'Encore un');
    submit();
    http.expectOne({ method: 'POST', url: URL }).flush(null, { status: 429, statusText: 'Too Many Requests' });
    await stable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toBe(
      'Limite atteinte : 5 messages par 24 h et 20 en attente de traitement au plus. Réessayez plus tard.',
    );
  });

  it('filtre par statut, avec compteurs et état vide', async () => {
    const labels = () => [...el.querySelectorAll('[aria-label="Filtrer par statut"] button')].map((b) => clean(b.textContent));
    expect(labels()).toEqual(['Tous (1)', 'Nouveau (0)', 'Traité (1)']);
    filterBy('Nouveau');
    await stable();
    expect(items()).toHaveLength(0);
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucun retour nouveau.');
    expect(el.querySelector('[aria-label="Filtrer par statut"] [aria-pressed="true"]')?.textContent).toContain('Nouveau');
    filterBy('Traité');
    await stable();
    expect(items()).toHaveLength(1);
  });
});

describe('Donner mon avis : chargement et liste vide', () => {
  it('« Chargement… » puis état vide', async () => {
    await harness.navigateByUrl('/');
    http.match(() => true).forEach((r) => r.flush([]));
    await harness.navigateByUrl('/feedback');
    el = harness.routeNativeElement!;
    expect(clean(el.querySelector('[role="status"]')?.textContent)).toBe('Chargement…');
    http.expectOne(URL).flush([]);
    await stable();
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucun retour envoyé.');
    expect(el.querySelector('[aria-label="Filtrer par statut"]')).toBeNull();
  });
});
