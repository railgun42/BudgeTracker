import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminFeedbackDto, FeedbackType } from '@budgetracker/shared';
import { routes } from '../../../app.routes';
import { Session } from '../../../core/auth/session';
import { provideApiHttp } from '../../../core/http';

const ADMIN = { id: 'u1', email: 'admin@example.com', name: 'Admin', lastConnection: null, role: 'ADMIN' };
const URL = '/api/v1/admin/feedback';
const fb = (id: string, over: Partial<AdminFeedbackDto> = {}): AdminFeedbackDto => ({
  id,
  type: FeedbackType.IDEA,
  message: 'Un mode sombre',
  status: 'NEW',
  createdAt: '2026-10-15T08:00:00.000Z',
  treatedAt: null,
  expiresAt: '2027-01-13T08:00:00.000Z',
  expiringSoon: false,
  ...over,
});
const NEW = fb('f1');
const OLD = fb('f2', { type: FeedbackType.PROBLEM, message: '<img src=x onerror=alert(1)>\nDeux lignes', expiringSoon: true });
const DONE = fb('f3', { type: FeedbackType.OPINION, status: 'TREATED', treatedAt: '2026-10-15T09:00:00.000Z' });

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const cards = () => [...el.querySelectorAll('ul[aria-label="Retours"] li.card')];
const buttons = () => [...el.querySelectorAll('button')].map((b) => clean(b.textContent));

function select(id: string, value: string): void {
  const input = el.querySelector<HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('change'));
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(ADMIN);
  await restored;
  harness = await RouterTestingHarness.create('/admin/feedback');
  el = harness.routeNativeElement!;
  http.expectOne(`${URL}?sort=date`).flush([NEW, OLD, DONE]);
  await stable();
});

afterEach(() => http.verify());

describe('Administration : retours utilisateurs', () => {
  it('liste : type, statut, texte brut, avertissement pour les retours bientôt supprimés', () => {
    expect(cards().map((c) => clean(c.querySelector('p')?.textContent)?.replace(/ · .+ · /, ' · '))).toEqual([
      'Idée de fonctionnalité · Nouveau',
      'Problème · Nouveau',
      'Avis · Traité',
    ]);
    const old = cards()[1];
    expect(old.querySelector('.message')?.textContent).toBe('<img src=x onerror=alert(1)>\nDeux lignes');
    expect(old.querySelector('img')).toBeNull();
    expect(clean(old.textContent)).toContain('Bientôt supprimé : Suppression le');
    expect(clean(el.querySelector('[role="status"]')?.textContent)).toBe("1 retour(s) non traité(s) seront supprimés automatiquement d'ici 7 jours.");
    // Bouton seulement sur les nouveaux.
    expect(buttons().filter((b) => b?.startsWith('Marquer comme traité'))).toHaveLength(2);
    expect(el.textContent).not.toContain('@');
  });

  it('filtres type et statut, tri : la liste est redemandée avec les paramètres', async () => {
    select('filter-type', 'PROBLEM');
    http.expectOne(`${URL}?type=PROBLEM&sort=date`).flush([OLD]);
    select('filter-status', 'NEW');
    http.expectOne(`${URL}?type=PROBLEM&status=NEW&sort=date`).flush([OLD]);
    select('filter-sort', 'status');
    http.expectOne(`${URL}?type=PROBLEM&status=NEW&sort=status`).flush([OLD]);
    await stable();
    expect(cards()).toHaveLength(1);
    select('filter-type', '');
    http.expectOne(`${URL}?status=NEW&sort=status`).flush([NEW, OLD]);
    await stable();
    expect(cards()).toHaveLength(2);
  });

  it('marquer comme traité : POST puis rechargement', async () => {
    (el.querySelector('li.card button') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: `${URL}/f1/treat` });
    req.flush({ ...NEW, status: 'TREATED', treatedAt: '2026-10-15T10:00:00.000Z' });
    http.expectOne(`${URL}?sort=date`).flush([{ ...NEW, status: 'TREATED' }, OLD, DONE]);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Retour marqué comme traité.');
    expect(buttons().filter((b) => b?.startsWith('Marquer comme traité'))).toHaveLength(1);
  });
});
