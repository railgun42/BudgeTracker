import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CategoryDto } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
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
const HOUSING = cat('c3', { nameKey: 'housing', hidden: true, customName: 'Maison' });
const TRANSFER = cat('c4', { nameKey: 'transfer' });
const VELO = cat('p1', { system: false, name: 'Vélo', parentId: 'c1' });
const ALL = [SPORT, LICENCE, HOUSING, TRANSFER, VELO];

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;
const options = (id: string) => [...el.querySelectorAll(`#${id} option`)].map((o) => clean(o.textContent));

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

async function open(list: CategoryDto[] = ALL): Promise<void> {
  harness = await RouterTestingHarness.create('/categories');
  el = harness.routeNativeElement!;
  http.expectOne('/api/v1/categories').flush(list);
  await stable();
}

async function act(click: () => void, method: string, url: string, response: CategoryDto | null, reload: CategoryDto[]) {
  click();
  const req = http.expectOne({ method, url });
  req.flush(response);
  http.expectOne('/api/v1/categories').flush(reload);
  await stable();
  return req.request.body;
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Mes catégories', () => {
  it('arbre globales et perso, noms personnalisés, masquées signalées, techniques absentes', async () => {
    await open();
    const rows = [...el.querySelectorAll('.card p')].map((p) => clean(p.textContent));
    expect(rows).toEqual(['Maison (globale, d\'origine « Logement », masquée)', 'Sport (globale)', 'Licence (globale)', 'Vélo (personnelle)']);
    expect(el.querySelector('[aria-label="Sous-catégories de Sport"]')).not.toBeNull();
    // Parents possibles : racines proposées à la saisie (ni masquée ni technique).
    expect(options('cat-parent')).toEqual(['Aucune : catégorie principale', 'Sport']);
  });

  it('masquer une catégorie globale envoie la préférence sans perdre le nom personnalisé', async () => {
    await open();
    expect(await act(() => button('Masquer Sport').click(), 'PUT', '/api/v1/categories/c1/preference', { ...SPORT, hidden: true }, ALL)).toEqual({
      hidden: true,
      customName: null,
    });
    expect(await act(() => button('Afficher Maison').click(), 'PUT', '/api/v1/categories/c3/preference', { ...HOUSING, hidden: false }, ALL)).toEqual({
      hidden: false,
      customName: 'Maison',
    });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('« Maison » mise à jour.');
  });

  it('renommer une globale pour soi seul ; nom vide ⇒ nom d’origine ; perso ⇒ PATCH', async () => {
    await open();
    button('Renommer Sport').click();
    await stable();
    type('rename-c1', '  Activités  ');
    const submit = () => el.querySelector<HTMLFormElement>('form.inline')!.dispatchEvent(new Event('submit'));
    expect(await act(submit, 'PUT', '/api/v1/categories/c1/preference', SPORT, ALL)).toEqual({ hidden: false, customName: 'Activités' });

    button('Renommer Maison').click();
    await stable();
    type('rename-c3', '');
    expect(await act(submit, 'PUT', '/api/v1/categories/c3/preference', HOUSING, ALL)).toEqual({ hidden: true, customName: null });

    button('Renommer Vélo').click();
    await stable();
    type('rename-p1', 'Cyclisme');
    expect(await act(submit, 'PATCH', '/api/v1/categories/p1', VELO, ALL)).toEqual({ name: 'Cyclisme' });
  });

  it('crée une sous-catégorie sous une catégorie globale', async () => {
    await open();
    el.querySelector<HTMLFormElement>('form.form')!.dispatchEvent(new Event('submit'));
    await stable();
    expect(el.querySelector('#cat-name')?.getAttribute('aria-invalid')).toBe('true'); // nom obligatoire
    type('cat-name', ' Escalade ');
    type('cat-parent', 'c1');
    const submit = () => el.querySelector<HTMLFormElement>('form.form')!.dispatchEvent(new Event('submit'));
    expect(await act(submit, 'POST', '/api/v1/categories', cat('p2', { system: false, name: 'Escalade', parentId: 'c1' }), ALL)).toEqual({
      name: 'Escalade',
      parentId: 'c1',
    });
  });

  it('suppression d’une perso : 409 ⇒ demande une cible, puis réaffectation', async () => {
    await open();
    expect(button('Supprimer Sport')).toBeUndefined(); // globale : non supprimable
    button('Supprimer Vélo').click();
    await stable();
    expect(options('reassign-p1')).toEqual(['Aucune (catégorie inutilisée)', 'Maison', 'Sport', 'Sport › Licence']);

    const confirm = () => button('Confirmer la suppression').click();
    confirm();
    http.expectOne({ method: 'DELETE', url: '/api/v1/categories/p1' }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toBe('Catégorie utilisée : choisissez une catégorie de remplacement.');

    type('reassign-p1', 'c2');
    await act(confirm, 'DELETE', '/api/v1/categories/p1?reassignTo=c2', null, [SPORT, LICENCE, HOUSING]);
    expect(el.querySelector('.tree')?.textContent).not.toContain('Vélo');
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Catégorie « Vélo » supprimée.');
  });

  it('globales de l’admin : nom d’origine = nom de l’admin ; archivée signalée, ni parent ni cible de réaffectation', async () => {
    const AIDE = cat('a1', { name: 'Aide sociale', customName: 'Aides' });
    const OLD = cat('a2', { name: 'Ancienne', archived: true });
    await open([...ALL, AIDE, OLD]);
    const rows = [...el.querySelectorAll('.card p')].map((p) => clean(p.textContent));
    expect(rows).toContain('Aides (globale, d\'origine « Aide sociale »)');
    expect(rows).toContain('Ancienne (globale, archivée)');
    expect(options('cat-parent')).toEqual(['Aucune : catégorie principale', 'Aides', 'Sport']);
    button('Supprimer Vélo').click();
    await stable();
    expect(options('reassign-p1')).not.toContain('Ancienne');
  });
});
