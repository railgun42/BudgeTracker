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
const cards = () => [...el.querySelectorAll('ul[aria-label="Retours"] li.row')];
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
});

async function load(list: AdminFeedbackDto[] = [NEW, OLD, DONE]): Promise<void> {
  http.expectOne(`${URL}?sort=date`).flush(list);
  await stable();
}

afterEach(() => http.verify());

describe('Administration : retours utilisateurs', () => {
  it('liste : type, statut, texte brut, avertissement pour les retours bientôt supprimés', async () => {
    await load();
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
    await load();
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
    await load();
    (el.querySelector('li.row button') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: `${URL}/f1/treat` });
    req.flush({ ...NEW, status: 'TREATED', treatedAt: '2026-10-15T10:00:00.000Z' });
    http.expectOne(`${URL}?sort=date`).flush([{ ...NEW, status: 'TREATED' }, OLD, DONE]);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Retour marqué comme traité.');
    expect(buttons().filter((b) => b?.startsWith('Marquer comme traité'))).toHaveLength(1);
  });

  it('pastilles : statut avec icône, « Bientôt supprimé » écrit en avertissement, dates lisibles', async () => {
    await load();
    const [first, old] = cards();
    expect(clean(first.querySelector('.status')?.textContent)).toBe('Nouveau');
    expect(first.querySelector('.status svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(first.querySelector('.health')).toBeNull();
    const warn = old.querySelector('.health.health-warn');
    expect(clean(warn?.textContent)).toBe('Bientôt supprimé');
    expect(warn?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(old.classList).toContain('expiring');
    expect(first.querySelector('time')?.getAttribute('datetime')).toBe(NEW.createdAt);
    expect(clean(first.querySelector('time')?.textContent)).toMatch(/^15 oct\. 2026, \d{2}:\d{2}$/);
    expect(first.querySelector(`time[datetime="${NEW.expiresAt}"]`)?.textContent).toMatch(/^1[34] janv\. 2027$/);
    expect(el.querySelector('.alert-warning[role="status"]')).not.toBeNull();
  });

  it("compteurs de la liste affichée dans l'en-tête", async () => {
    await load();
    expect(clean(el.querySelector('.counts')?.textContent)).toBe('3 retours affichés, dont 2 nouveaux');
    select('filter-type', 'OPINION');
    http.expectOne(`${URL}?type=OPINION&sort=date`).flush([DONE]);
    await stable();
    expect(clean(el.querySelector('.counts')?.textContent)).toBe('1 retour affiché, dont 0 nouveau');
  });

  it('« Chargement… » puis liste vide ; liste filtrée vide', async () => {
    expect(clean(el.querySelector('[role="status"]')?.textContent)).toBe('Chargement…');
    await load([]);
    expect(el.textContent).not.toContain('Chargement…');
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucun retour.');
    expect(el.querySelector('.counts')).toBeNull();
    select('filter-status', 'TREATED');
    http.expectOne(`${URL}?status=TREATED&sort=date`).flush([]);
    await stable();
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucun retour ne correspond à ces filtres.');
  });

  it('erreur : pas de « Chargement… », « Recharger » relance la liste', async () => {
    http.expectOne(`${URL}?sort=date`).flush(null, { status: 500, statusText: 'Erreur' });
    await stable();
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(el.textContent).not.toContain('Chargement…');
    (alert.querySelector('button.link-button') as HTMLButtonElement).click();
    await load();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(cards()).toHaveLength(3);
  });

  it('marquage en cours : boutons désactivés, puis confirm-pop sur la ligne traitée seulement', async () => {
    await load();
    (el.querySelector('li.row button') as HTMLButtonElement).click();
    await stable();
    const marking = [...el.querySelectorAll<HTMLButtonElement>('li.row button')];
    expect(marking.every((b) => b.disabled)).toBe(true);
    expect(clean(marking[0].textContent)).toBe('Marquage en cours…');
    http.expectOne({ method: 'POST', url: `${URL}/f1/treat` }).flush({ ...NEW, status: 'TREATED' });
    http.expectOne(`${URL}?sort=date`).flush([{ ...NEW, status: 'TREATED' }, OLD, DONE]);
    await stable();
    expect(cards().map((c) => c.classList.contains('confirm-pop'))).toEqual([true, false, false]);
    expect(el.querySelector('.alert-success')?.textContent).toContain('Retour marqué comme traité.');
    expect([...el.querySelectorAll<HTMLButtonElement>('li.row button')].every((b) => !b.disabled)).toBe(true);
  });

  it('échec du marquage : erreur affichée, bouton réactivé', async () => {
    await load();
    (el.querySelector('li.row button') as HTMLButtonElement).click();
    http.expectOne({ method: 'POST', url: `${URL}/f1/treat` }).flush(null, { status: 404, statusText: 'Introuvable' });
    await stable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toContain('Ce retour n’existe plus.');
    expect((el.querySelector('li.row button') as HTMLButtonElement).disabled).toBe(false);
  });
});
