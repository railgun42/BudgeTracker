import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

function type(value: string): void {
  const input = el.querySelector<HTMLInputElement>('#delete-confirm')!;
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
  it('affiche l’utilisateur ; l’export CSV télécharge le fichier renvoyé par l’API', async () => {
    expect(el.textContent).toContain('alice@example.com');
    const blob = new Blob(['User']);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect([this.href, this.download]).toEqual(['blob:x', 'budgetracker-export.csv']);
    });

    button('Exporter en CSV').click();
    const req = http.expectOne((r) => r.url === '/api/v1/me/export');
    expect(req.request.params.get('format')).toBe('csv');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
    await stable();

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('suppression : bouton actif seulement après la saisie exacte, puis session vidée et retour à la connexion', async () => {
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

  it('échec de la suppression : message, session conservée', async () => {
    type('SUPPRIMER');
    await stable();
    button('Supprimer définitivement').click();
    http.expectOne('/api/v1/me').flush(null, { status: 500, statusText: 'Error' });
    await stable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('indisponible');
    expect(TestBed.inject(Session).user()).toEqual(USER);
  });
});
