import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { formatBytes } from './my-account-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice Martin', lastConnection: null, createdAt: '2026-10-03T09:00:00.000Z' };
const STORAGE = { usedBytes: 3 * 1024 * 1024, quotaBytes: 200 * 1024 * 1024 };

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
// Intl sépare nombre et unité par une espace insécable fine.
const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ');
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
const dialogOf = (id: string) => el.querySelector(`#${id}`)!.closest('dialog')!;

function type(value: string, id = 'delete-confirm'): void {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
  harness = await RouterTestingHarness.create('/me');
  el = harness.routeNativeElement!;
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('Mon compte', () => {
  it('profil : initiales, nom — e-mail, inscription, stockage (chargement puis valeur)', async () => {
    expect(el.querySelector('.profile-avatar')?.textContent?.trim()).toBe('AM');
    expect(el.textContent).toContain('Alice Martin — alice@example.com');
    expect(el.textContent).toContain('3 oct. 2026');
    expect(el.textContent).toContain('Dernière connexion');
    expect(el.querySelector('.storage [role="status"]')?.textContent).toContain('Chargement');

    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    await stable();
    expect(text('.storage')).toContain('3 Mo utilisés sur 200 Mo (2 %)');
    expect(el.querySelector('a[href="/me/coffre"]')?.textContent).toContain('Ouvrir le coffre-fort');
  });

  it('stockage indisponible : message, pas de chargement sans fin', async () => {
    http.expectOne('/api/v1/me/storage').flush(null, { status: 500, statusText: 'Error' });
    await stable();
    expect(el.querySelector('.storage')?.textContent).toContain('indisponible');
  });

  it('l’export CSV télécharge le fichier renvoyé par l’API, puis confirme', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    const blob = new Blob(['User']);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect([this.href, this.download]).toEqual(['blob:x', 'budgetracker-export.csv']);
    });

    button('Exporter en CSV').click();
    await stable();
    expect(el.textContent).toContain('Export CSV en cours');
    expect(button('Exporter en JSON').disabled).toBe(true);
    const req = http.expectOne((r) => r.url === '/api/v1/me/export');
    expect(req.request.params.get('format')).toBe('csv');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
    await stable();

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(el.querySelector('.alert-success')?.textContent).toContain('Export CSV téléchargé.');
  });

  it('échec de l’export : message d’erreur, boutons réactivés', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Exporter en JSON').click();
    http.expectOne((r) => r.url === '/api/v1/me/export').flush(null, { status: 500, statusText: 'Error' });
    await stable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('indisponible');
    expect(button('Exporter en JSON').disabled).toBe(false);
  });

  it('suppression : modale, bouton actif seulement après la saisie exacte, puis session vidée et retour à la connexion', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Supprimer mon compte…').click();
    await stable();
    expect(dialogOf('delete-confirm').hasAttribute('open')).toBe(true);

    const remove = button('Supprimer définitivement');
    expect(remove.disabled).toBe(true);
    type('supprimer');
    await stable();
    expect(remove.disabled).toBe(true);
    type('SUPPRIMER');
    await stable();
    expect(remove.disabled).toBe(false);

    remove.click();
    const req = http.expectOne('/api/v1/me');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await stable();

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(TestBed.inject(Router).url).toMatch(/^\/login/);
  });

  it('échec de la suppression : message dans la modale, session conservée', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Supprimer mon compte…').click();
    type('SUPPRIMER');
    await stable();
    button('Supprimer définitivement').click();
    http.expectOne('/api/v1/me').flush(null, { status: 500, statusText: 'Error' });
    await stable();

    expect(dialogOf('delete-confirm').querySelector('[role="alert"]')?.textContent).toContain('indisponible');
    expect(TestBed.inject(Session).user()).toEqual(USER);
  });

  it('Annuler ferme la modale et vide la saisie', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Supprimer mon compte…').click();
    type('SUPPRIMER');
    await stable();
    [...dialogOf('delete-confirm').querySelectorAll('button')].find((b) => b.textContent?.includes('Annuler'))!.click();
    await stable();
    expect(dialogOf('delete-confirm').hasAttribute('open')).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#delete-confirm')!.value).toBe('');
  });

  it('réinitialisation : mot exact (accent facultatif), POST /me/reset, modale fermée, message, stockage relu, session gardée', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Réinitialiser mon compte…').click();
    await stable();
    const confirm = [...dialogOf('reset-confirm').querySelectorAll('button')].find((b) => b.type === 'submit')!;
    type('réinitialiser', 'reset-confirm');
    await stable();
    expect(confirm.disabled).toBe(true);
    type('REINITIALISER', 'reset-confirm');
    await stable();
    expect(confirm.disabled).toBe(false);

    confirm.click();
    const req = http.expectOne('/api/v1/me/reset');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await stable();

    expect(dialogOf('reset-confirm').hasAttribute('open')).toBe(false);
    expect(el.querySelector('.alert-success')?.textContent).toContain('Compte réinitialisé');
    http.expectOne('/api/v1/me/storage').flush({ ...STORAGE, usedBytes: 0 });
    await stable();
    expect(text('.storage')).toContain('0 ko utilisés');
    expect(TestBed.inject(Session).user()).toEqual(USER);
  });

  it('échec de la réinitialisation : message dans la modale, qui reste ouverte', async () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    button('Réinitialiser mon compte…').click();
    type('RÉINITIALISER', 'reset-confirm');
    await stable();
    [...dialogOf('reset-confirm').querySelectorAll('button')].find((b) => b.type === 'submit')!.click();
    http.expectOne('/api/v1/me/reset').flush(null, { status: 500, statusText: 'Error' });
    await stable();
    expect(dialogOf('reset-confirm').hasAttribute('open')).toBe(true);
    expect(dialogOf('reset-confirm').querySelector('[role="alert"]')?.textContent).toContain('indisponible');
  });
});

describe('formatBytes', () => {
  it('ko sous 1 Mo (arrondi au supérieur), Mo au-delà', () => {
    http.expectOne('/api/v1/me/storage').flush(STORAGE);
    const plain = (n: number) => formatBytes(n).replace(/\s/g, ' ');
    expect(plain(0)).toBe('0 ko');
    expect(plain(14)).toBe('1 ko');
    expect(plain(1.5 * 1024 * 1024)).toBe('1,5 Mo');
  });
});
