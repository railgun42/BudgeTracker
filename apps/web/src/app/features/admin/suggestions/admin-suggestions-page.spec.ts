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
const cards = () => [...el.querySelectorAll('ul[aria-label="Suggestions"] li.row')];
const dialog = () => el.querySelector<HTMLDialogElement>('dialog')!;
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;
const field = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
const submit = () => dialog().querySelector('form')!.dispatchEvent(new Event('submit'));

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(ADMIN);
  await restored;
  harness = await RouterTestingHarness.create('/admin/suggestions');
  el = harness.routeNativeElement!;
});

async function load(list: CategorySuggestionDto[] = [ESCALADE, HTML, DONE], categories: CategoryDto[] = [SPORT]): Promise<void> {
  http.expectOne(URL).flush(list);
  http.expectOne('/api/v1/admin/categories').flush(categories);
  await stable();
}

afterEach(() => http.verify());

describe('Administration : suggestions de catégorie', () => {
  beforeEach(() => load());

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
    expect(clean(el.querySelector('[aria-live] .alert-success')?.textContent)).toBe('Suggestion « Escalade » : acceptée, réponse envoyée.');
    expect(dialog().open).toBe(false);
    expect(dialog().querySelector('form')).toBeNull();
    expect(cards().map((c) => c.classList.contains('confirm-pop'))).toEqual([true, false, false]);
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
    expect(clean(dialog().querySelector('[role="alert"]')?.textContent)).toMatch(/catégorie globale porte déjà ce nom .*marquez-la alors comme traitée/);
    expect(dialog().open).toBe(true);
    expect(clean(el.querySelector('.alert-error')?.textContent)).toMatch(/Recharger$/);
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

  it('ligne : icône du parent (étiquette pour une principale), date lisible, statut en pastille avec icône', () => {
    const [escalade, html, yoga] = cards();
    expect(escalade.querySelector('svg.category-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(escalade.querySelector('svg.category-icon path')?.getAttribute('d')).not.toBe(html.querySelector('svg.category-icon path')?.getAttribute('d'));
    expect(escalade.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-15T08:00:00.000Z');
    expect(clean(escalade.querySelector('time')?.textContent)).toMatch(/^15 oct\. 2026/);
    expect(clean(yoga.querySelector('.badge-neutral')?.textContent)).toBe('Refusée');
    expect(yoga.querySelector('.badge-neutral svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(escalade.querySelector('.badge-neutral path')?.getAttribute('d')).not.toBe(yoga.querySelector('.badge-neutral path')?.getAttribute('d'));
  });

  it('en-tête : compteurs de la liste affichée et limite de 20 en attente par utilisateur', () => {
    expect(clean(el.querySelector('.counts')?.textContent)).toBe('3 suggestions affichées, dont 2 en attente');
    expect(el.textContent).toContain('au plus 20 suggestions en attente');
  });

  it('modale : titre, conséquence, aperçu de la notification et compteur ; Annuler n’envoie rien', async () => {
    expect(dialog().open).toBe(false);
    button('Refuser « Escalade »').click();
    await stable();
    expect(dialog().open).toBe(true);
    expect(clean(dialog().querySelector('h2')?.textContent)).toBe('Refuser « Escalade » ?');
    expect(dialog().textContent).toContain('aucune catégorie globale n’est créée');
    expect(clean(dialog().querySelector('.preview .message')?.textContent)).toMatch(/je ne l'ai pas retenue/);
    expect(clean(dialog().querySelector('.preview strong')?.textContent)).toBe('Message de l’administrateur');
    const reply = field<HTMLTextAreaElement>('reply-s1');
    expect(reply.getAttribute('aria-describedby')).toBe('reply-s1-hint reply-s1-count');
    expect(clean(field('reply-s1-count').textContent)).toBe(`${reply.value.length} / 2000 caractères.`);
    reply.value = 'x'.repeat(1950);
    reply.dispatchEvent(new Event('input'));
    await stable();
    expect(field('reply-s1-count').className).toBe('field-warning');
    expect(clean(field('reply-s1-count').textContent)).toBe('1950 / 2000 caractères : plus que 50.');
    expect(clean([...dialog().querySelectorAll('button')].find((b) => b.type === 'submit')?.textContent)).toBe('Confirmer : refuser');
    button('Annuler').click();
    await stable();
    expect(dialog().open).toBe(false);
  });

  it('décision en cours : bouton désactivé, puis réactivé après une erreur (404)', async () => {
    button('Marquer comme traitée « Escalade »').click();
    await stable();
    submit();
    await stable();
    const confirm = () => [...dialog().querySelectorAll('button')].find((b) => b.type === 'submit')!;
    expect(clean(confirm().textContent)).toBe('Décision en cours…');
    expect(confirm().disabled).toBe(true);
    http.expectOne({ method: 'POST', url: `${URL}/s1/resolve` }).flush(null, { status: 404, statusText: 'Not Found' });
    await stable();
    expect(confirm().disabled).toBe(false);
    expect(clean(dialog().querySelector('[role="alert"]')?.textContent)).toBe('Cette suggestion n’existe plus.');
  });

  it('réponse trop longue : champ invalide relié à son aide, rien n’est envoyé', async () => {
    button('Accepter « Escalade »').click();
    await stable();
    const reply = field<HTMLTextAreaElement>('reply-s1');
    reply.value = 'x'.repeat(2001);
    reply.dispatchEvent(new Event('input'));
    await stable();
    expect(reply.getAttribute('aria-invalid')).toBe('true');
    expect(field('reply-s1-hint').className).toBe('field-error');
    submit();
    http.expectNone({ method: 'POST', url: `${URL}/s1/resolve` });
  });

  it('erreur de chargement : « Recharger » relance la liste', async () => {
    el.querySelector<HTMLSelectElement>('#filter-status')!.value = 'ACCEPTED';
    el.querySelector('#filter-status')!.dispatchEvent(new Event('change'));
    http.expectOne(`${URL}?status=ACCEPTED`).flush(null, { status: 500, statusText: 'Error' });
    await stable();
    button('Recharger').click();
    http.expectOne(`${URL}?status=ACCEPTED`).flush([]);
    await stable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucune suggestion ne correspond à ce filtre.');
  });
});

describe('Administration : suggestions, chargement et liste vide', () => {
  it('« Chargement… » puis « Aucune suggestion. »', async () => {
    expect(clean(el.querySelector('[role="status"]')?.textContent)).toBe('Chargement…');
    await load([], []);
    expect(el.textContent).not.toContain('Chargement…');
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucune suggestion.');
    expect(el.querySelector('.counts')).toBeNull();
  });
});
