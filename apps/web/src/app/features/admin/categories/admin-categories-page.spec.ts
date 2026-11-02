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
// Erreur répétée dans la modale (la page derrière est inerte) ; le bandeau de la page porte en plus « Recharger ».
const alertText = () => clean(el.querySelector('dialog [role="alert"]')?.textContent);
const pageAlert = () => el.querySelector(':scope > [role="alert"]');
const status = () => clean(el.querySelector('[role="status"]')?.textContent);
const dialogOf = (id: string) => el.querySelector(`#${id}`)?.closest('dialog');
const deleteDialog = () => el.querySelector<HTMLDialogElement>('dialog[aria-labelledby="global-del-title"]')!;
const inDelete = (label: string) => [...deleteDialog().querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
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
    const rows = [...el.querySelectorAll('.row-main')].map((p) => clean(p.textContent));
    expect(rows).toEqual(['Aide sociale', 'Ancienne, archivée', 'Sport', 'Licence']);
    expect(el.querySelector('.archived .badge-neutral')?.textContent).toBe('archivée');
    // Icône décorative sur les racines seulement.
    expect(el.querySelectorAll('.group > .row .category-icon[aria-hidden="true"]')).toHaveLength(3);
    expect(el.querySelector('.sub .category-icon')).toBeNull();
    expect(button('Restaurer Ancienne')).toBeDefined();
    expect(button('Archiver Sport')).toBeDefined();
    // Parents possibles : racines ni archivées ni techniques.
    expect(options('global-parent')).toEqual(['Aucune : catégorie principale', 'Aide sociale', 'Sport']);
  });

  it('chargement, puis erreur avec « Recharger » qui relance la lecture', async () => {
    await harness.navigateByUrl('/page-introuvable');
    await harness.navigateByUrl('/admin/categories');
    el = harness.routeNativeElement!;
    expect(status()).toBe('Chargement…');
    expect(el.querySelector('.groups')).toBeNull();

    http.expectOne(URL).flush(null, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(status()).toBeUndefined();
    const reload = [...pageAlert()!.querySelectorAll('button')].find((b) => clean(b.textContent) === 'Recharger')!;
    reload.click();
    await stable();
    expect(pageAlert()).toBeNull();
    expect(status()).toBe('Chargement…');
    http.expectOne(URL).flush(ALL);
    await stable();
    expect(el.querySelectorAll('.group')).toHaveLength(3);
  });

  it('liste vide signalée', async () => {
    await harness.navigateByUrl('/page-introuvable');
    await harness.navigateByUrl('/admin/categories');
    el = harness.routeNativeElement!;
    http.expectOne(URL).flush([TRANSFER]);
    await stable();
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucune catégorie globale. Créez-en une avec « Nouvelle catégorie globale ».');
  });

  it('crée une sous-catégorie globale en modale ; nom obligatoire', async () => {
    button('Nouvelle catégorie globale').click();
    await stable();
    expect(dialogOf('global-name')?.hasAttribute('open')).toBe(true);
    submitForm('form.form');
    await stable();
    expect(el.querySelector('#global-name')?.getAttribute('aria-invalid')).toBe('true');
    type('global-name', '  Allocations ');
    type('global-parent', 'a1');
    const body = await act(() => submitForm('form.form'), 'POST', URL, cat('a3', { name: 'Allocations', parentId: 'a1' }));
    expect(body).toEqual({ name: 'Allocations', parentId: 'a1' });
    expect(dialogOf('global-name')?.hasAttribute('open')).toBe(false); // fermée après succès
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

  it('renomme une catégorie (seedée comprise) par PATCH, focus dans le champ, confirm-pop sur la ligne', async () => {
    button('Renommer Sport').click();
    await stable();
    expect(document.activeElement?.id).toBe('rename-c1');
    type('rename-c1', ' Activités sportives ');
    const body = await act(() => submitForm('form.inline'), 'PATCH', `${URL}/c1`, { ...SPORT, name: 'Activités sportives' });
    expect(body).toEqual({ name: 'Activités sportives' });
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Catégorie renommée en « Activités sportives ».');
    expect(clean(el.querySelector('.row.confirm-pop .row-main')?.textContent)).toBe('Sport'); // liste relue (ALL)
  });

  it('Échap annule le renommage', async () => {
    button('Renommer Sport').click();
    await stable();
    el.querySelector('form.inline')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await stable();
    expect(el.querySelector('#rename-c1')).toBeNull();
    expect(button('Renommer Sport')).toBeDefined();
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
    expect(deleteDialog().hasAttribute('open')).toBe(true);
    expect(clean(deleteDialog().querySelector('h2')?.textContent)).toBe('Supprimer « Aide sociale »');
    expect(clean(deleteDialog().querySelector('h2 + p')?.textContent)).toBe('Supprimer définitivement « Aide sociale » pour tous les utilisateurs ?');
    expect(inDelete('Confirmer la suppression').classList).toContain('button-danger');
    inDelete('Annuler').click();
    await stable();
    expect(deleteDialog().hasAttribute('open')).toBe(false);
    expect(deleteDialog().querySelector('h2')).toBeNull();

    button('Supprimer Aide sociale').click();
    await stable();
    inDelete('Confirmer la suppression').click();
    await stable();
    expect(status()).toBe('Suppression en cours…');
    expect(inDelete('Confirmer la suppression').disabled).toBe(true);
    http.expectOne({ method: 'DELETE', url: `${URL}/a1` }).flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(deleteDialog().hasAttribute('open')).toBe(true); // erreur répétée dans la modale restée ouverte
    expect(alertText()).toBe('« Aide sociale » est utilisée (transaction, récurrence, sous-catégorie ou suggestion en attente) : archivez-la plutôt.');
    inDelete('Annuler').click();

    button('Supprimer Ancienne').click();
    await stable();
    inDelete('Confirmer la suppression').click();
    http.expectOne({ method: 'DELETE', url: `${URL}/a2` }).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(URL).flush([SPORT, LICENCE, TRANSFER, AIDE]);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('« Ancienne » supprimée.');
    expect(deleteDialog().hasAttribute('open')).toBe(false);
    expect(el.querySelector('.groups')?.textContent).not.toContain('Ancienne');
    expect(alertText()).toBeUndefined();
  });
});
