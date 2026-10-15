import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CategoryDto, CategorySuggestionDto } from '@budgetracker/shared';
import { routes } from '../../../app.routes';
import { Session } from '../../../core/auth/session';
import { provideApiHttp } from '../../../core/http';

const ADMIN = { id: 'u1', email: 'admin@example.com', name: 'Admin', lastConnection: null, role: 'ADMIN' };
const URL = '/api/v1/admin/category-suggestions';
const SPORT: CategoryDto = { id: 'c1', parentId: null, system: true, nameKey: 'sport', name: null, color: null, hidden: false, customName: null, archived: false };
const sug = (id: string, over: Partial<CategorySuggestionDto> = {}): CategorySuggestionDto => ({
  id,
  name: 'Escalade',
  parentId: 'c1',
  status: 'PENDING',
  createdAt: '2026-10-15T08:00:00.000Z',
  treatedAt: null,
  ...over,
});
const ESCALADE = sug('s1');
const HTML = sug('s2', { name: '<img src=x onerror=alert(1)>', parentId: null });
const DONE = sug('s3', { name: 'Yoga', parentId: null, status: 'REJECTED', treatedAt: '2026-10-15T09:00:00.000Z' });

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const cards = () => [...el.querySelectorAll('ul[aria-label="Suggestions"] li.card')];
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;
const field = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
const submit = () => el.querySelector<HTMLFormElement>('li.card form')!.dispatchEvent(new Event('submit'));

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(ADMIN);
  await restored;
  harness = await RouterTestingHarness.create('/admin/suggestions');
  el = harness.routeNativeElement!;
  http.expectOne(URL).flush([ESCALADE, HTML, DONE]);
  http.expectOne('/api/v1/admin/categories').flush([SPORT]);
  await stable();
});

afterEach(() => http.verify());

describe('Administration : suggestions de catégorie', () => {
  it('liste : nom en texte brut, parent, statut ; actions sur les seules suggestions en attente', () => {
    expect(cards().map((c) => clean(c.querySelector('p')?.textContent)?.replace(/ · .+ · /, ' · '))).toEqual([
      'Escalade dans « Sport » · En attente',
      '<img src=x onerror=alert(1)> · En attente',
      'Yoga · Refusée',
    ]);
    expect(el.querySelector('ul[aria-label="Suggestions"] img')).toBeNull();
    expect(cards()[0].querySelectorAll('button')).toHaveLength(3);
    expect(cards()[2].querySelectorAll('button')).toHaveLength(0);
    expect(JSON.stringify(el.textContent)).not.toContain('@');
  });

  it('accepter : réponse préremplie modifiable envoyée à l’auteur, puis rechargement', async () => {
    button('Accepter « Escalade »').click();
    await stable();
    expect(field<HTMLTextAreaElement>('reply-s1').value).toBe("J'ai vu ta suggestion de la catégorie Escalade, je l'ai ajoutée, merci !");
    expect(field<HTMLInputElement>('send-s1').checked).toBe(true);
    const reply = field<HTMLTextAreaElement>('reply-s1');
    reply.value = '  Ajoutée sous Sport, merci !  ';
    reply.dispatchEvent(new Event('input'));
    submit();
    const req = http.expectOne({ method: 'POST', url: `${URL}/s1/resolve` });
    expect(req.request.body).toEqual({ decision: 'ACCEPTED', reply: 'Ajoutée sous Sport, merci !' });
    req.flush({ ...ESCALADE, status: 'ACCEPTED' });
    http.expectOne(URL).flush([{ ...ESCALADE, status: 'ACCEPTED' }, HTML, DONE]);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Suggestion « Escalade » : acceptée, réponse envoyée.');
    expect(el.querySelector('li.card form')).toBeNull();
  });

  it('refuser sans répondre : aucune réponse envoyée ; message prérempli propre à la décision', async () => {
    button('Refuser « Escalade »').click();
    await stable();
    expect(field<HTMLTextAreaElement>('reply-s1').value).toMatch(/je ne l'ai pas retenue/);
    field<HTMLInputElement>('send-s1').click();
    await stable();
    expect(el.querySelector('#reply-s1')).toBeNull();
    submit();
    const req = http.expectOne({ method: 'POST', url: `${URL}/s1/resolve` });
    expect(req.request.body).toEqual({ decision: 'REJECTED' });
    req.flush({ ...ESCALADE, status: 'REJECTED' });
    http.expectOne(URL).flush([]);
    await stable();
  });

  it('acceptation en conflit (409) : invite à marquer comme traitée', async () => {
    button('Accepter « Escalade »').click();
    await stable();
    submit();
    http.expectOne({ method: 'POST', url: `${URL}/s1/resolve` }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toMatch(/catégorie globale porte déjà ce nom .*marquez-la alors comme traitée/);
  });

  it('filtre par statut', async () => {
    const select = field<HTMLSelectElement>('filter-status');
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Tous', 'En attente', 'Acceptée', 'Refusée', 'Traitée']);
    select.value = 'PENDING';
    select.dispatchEvent(new Event('change'));
    http.expectOne(`${URL}?status=PENDING`).flush([ESCALADE]);
    await stable();
    expect(cards()).toHaveLength(1);
  });
});
