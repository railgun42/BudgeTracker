import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CategoryDto } from '@budgetracker/shared';
import { routes } from '../../../app.routes';
import { Session } from '../../../core/auth/session';
import { provideApiHttp } from '../../../core/http';

const ADMIN = { id: 'u1', email: 'admin@example.com', name: 'Admin', lastConnection: null, role: 'ADMIN' };
const cat = (id: string, over: Partial<CategoryDto> = {}): CategoryDto => ({
  id,
  parentId: null,
  system: true,
  nameKey: null,
  name: null,
  color: null,
  hidden: false,
  customName: null,
  archived: false,
  ...over,
});
const SPORT = cat('c1', { nameKey: 'sport' });
const LICENCE = cat('c2', { nameKey: 'sport.license', parentId: 'c1' });
const TRANSFER = cat('c3', { nameKey: 'transfer' });
const AIDE = cat('a1', { name: 'Aide sociale' });
const OLD = cat('a2', { name: 'Ancienne', archived: true });
const ALL = [SPORT, LICENCE, TRANSFER, AIDE, OLD];
const URL = '/api/v1/admin/categories';

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;
const options = (id: string) => [...el.querySelectorAll(`#${id} option`)].map((o) => clean(o.textContent));
const alertText = () => clean(el.querySelector('[role="alert"]')?.textContent);
const submitForm = (selector: string) => el.querySelector<HTMLFormElement>(selector)!.dispatchEvent(new Event('submit'));

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

/** Requête attendue, réponse, puis rechargement de la liste ; renvoie le corps envoyé. */
async function act(click: () => void, method: string, url: string, response: CategoryDto, reload = ALL) {
  click();
  const req = http.expectOne({ method, url });
  req.flush(response);
  http.expectOne(URL).flush(reload);
  await stable();
  return req.request.body;
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(ADMIN);
  await restored;
  harness = await RouterTestingHarness.create('/admin/categories');
  el = harness.routeNativeElement!;
  http.expectOne(URL).flush(ALL);
  await stable();
});

afterEach(() => http.verify());

describe('Administration : catégories globales', () => {
  it('arbre des globales (libellés traduits ou libres), archivées signalées, techniques absentes', () => {
    const rows = [...el.querySelectorAll('.card p')].map((p) => clean(p.textContent));
    expect(rows).toEqual(['Aide sociale', 'Ancienne (archivée)', 'Sport', 'Licence']);
    expect(button('Restaurer Ancienne')).toBeDefined();
    expect(button('Archiver Sport')).toBeDefined();
    // Parents possibles : racines ni archivées ni techniques.
    expect(options('global-parent')).toEqual(['Aucune : catégorie principale', 'Aide sociale', 'Sport']);
  });

  it('crée une sous-catégorie globale ; nom obligatoire', async () => {
    submitForm('form.form');
    await stable();
    expect(el.querySelector('#global-name')?.getAttribute('aria-invalid')).toBe('true');
    type('global-name', '  Allocations ');
    type('global-parent', 'a1');
    const body = await act(() => submitForm('form.form'), 'POST', URL, cat('a3', { name: 'Allocations', parentId: 'a1' }));
    expect(body).toEqual({ name: 'Allocations', parentId: 'a1' });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Catégorie « Allocations » créée pour tous les utilisateurs.');
  });

  it('doublon d’un libellé traduit du seed refusé sans requête ; 409 du serveur affiché', async () => {
    type('global-name', 'sport');
    submitForm('form.form');
    await stable();
    expect(alertText()).toBe('Une catégorie porte déjà ce nom à cet endroit.');

    type('global-name', 'Dons');
    submitForm('form.form');
    http.expectOne({ method: 'POST', url: URL }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(alertText()).toBe('Une catégorie porte déjà ce nom à cet endroit.');
  });

  it('renomme une catégorie (seedée comprise) par PATCH', async () => {
    button('Renommer Sport').click();
    await stable();
    type('rename-c1', ' Activités sportives ');
    const body = await act(() => submitForm('form.inline'), 'PATCH', `${URL}/c1`, { ...SPORT, name: 'Activités sportives' });
    expect(body).toEqual({ name: 'Activités sportives' });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Catégorie renommée en « Activités sportives ».');
  });

  it('archive puis restaure', async () => {
    expect(await act(() => button('Archiver Aide sociale').click(), 'PATCH', `${URL}/a1`, { ...AIDE, archived: true })).toEqual({ archived: true });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('« Aide sociale » archivée.');
    expect(await act(() => button('Restaurer Ancienne').click(), 'PATCH', `${URL}/a2`, { ...OLD, archived: false })).toEqual({ archived: false });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('« Ancienne » restaurée.');
  });

  it('supprimer : uniquement les catégories créées par l’admin, après confirmation ; utilisée (409) ⇒ invite à archiver', async () => {
    expect(button('Supprimer Sport')).toBeUndefined(); // catégorie de base
    button('Supprimer Aide sociale').click();
    await stable();
    expect(clean(el.querySelector('[role="group"] p')?.textContent)).toBe('Supprimer définitivement « Aide sociale » pour tous les utilisateurs ?');
    button('Annuler').click();
    await stable();
    expect(el.querySelector('[role="group"]')).toBeNull();

    button('Supprimer Aide sociale').click();
    await stable();
    button('Confirmer la suppression').click();
    http.expectOne({ method: 'DELETE', url: `${URL}/a1` }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(alertText()).toBe('« Aide sociale » est utilisée (transaction, récurrence, sous-catégorie ou suggestion en attente) : archivez-la plutôt.');

    button('Supprimer Ancienne').click();
    await stable();
    button('Confirmer la suppression').click();
    http.expectOne({ method: 'DELETE', url: `${URL}/a2` }).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(URL).flush([SPORT, LICENCE, TRANSFER, AIDE]);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('« Ancienne » supprimée.');
    expect(el.querySelector('.tree')?.textContent).not.toContain('Ancienne');
    expect(alertText()).toBeUndefined();
  });
});
