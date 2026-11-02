import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NotificationDto, NotificationsDto } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { NotificationBell } from './notification-bell';

const USER = { id: 'u1', email: 'a@example.com', name: 'A', lastConnection: null, role: 'USER' };
const URL = '/api/v1/notifications';
const item = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  kind: 'ANNOUNCEMENT',
  message: 'Nouvelle catégorie',
  createdAt: '2026-10-15T08:00:00.000Z',
  read: false,
  ...over,
});
const state = (unreadCount: number, items: NotificationDto[] = []): NotificationsDto => ({ unreadCount, items });
const NO_CONTENT = { status: 204, statusText: 'No Content' };

let http: HttpTestingController;
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Cloche', () => {
  it('pastille avec le nombre de non lues, libellé accessible, relue à chaque navigation', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    const el = fixture.nativeElement as HTMLElement;
    http.expectOne(URL).flush(state(3, [item('n1')]));
    await fixture.whenStable();
    const bell = el.querySelector('button.bell')!;
    expect(bell.getAttribute('popovertarget')).toBe('notifications-panel');
    expect(bell.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(bell.getAttribute('aria-label')).toBe('Notifications (3 non lues)');
    expect(clean(el.querySelector('.badge')?.textContent)).toBe('3');

    await TestBed.inject(Router).navigateByUrl('/me');
    http.expectOne(URL).flush(state(1));
    await fixture.whenStable();
    expect(bell.getAttribute('aria-label')).toBe('Notifications (1 non lue)');
    expect(clean(el.querySelector('.badge')?.textContent)).toBe('1');

    await TestBed.inject(Router).navigateByUrl('/stats');
    http.expectOne(URL).flush(state(0));
    await fixture.whenStable();
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
    expect(el.querySelector('.badge')).toBeNull();
  });

  it('au-delà de 99 : « 99+ »', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    http.expectOne(URL).flush(state(120));
    await fixture.whenStable();
    expect(clean((fixture.nativeElement as HTMLElement).querySelector('.badge')?.textContent)).toBe('99+');
  });

  it('panneau : chargement, 5 premières (non lues marquées), lien vers la page complète', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#notifications-panel')!;
    await fixture.whenStable();
    expect(clean(panel.querySelector('[role="status"]')?.textContent)).toBe('Chargement…');

    const items = [item('n1', { kind: 'PERSONAL' }), ...['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => item(id, { read: true }))];
    http.expectOne(URL).flush(state(1, items));
    await fixture.whenStable();
    const rows = [...panel.querySelectorAll('li.row')];
    expect(rows.length).toBe(5);
    expect(clean(rows[0].querySelector('.row-head')?.textContent)).toMatch(/^Message de l’administrateur · .+ · Non lue$/);
    expect(rows.map((r) => r.classList.contains('unread-row'))).toEqual([true, false, false, false, false]);
    expect(clean(panel.querySelector('.panel-head')?.textContent)).toBe('Notifications · 1 non lue');
    const link = panel.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/notifications');
    expect(clean(link.textContent)).toBe('Voir toutes les notifications');
  });

  it('panneau vide', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    http.expectOne(URL).flush(state(0));
    await fixture.whenStable();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#notifications-panel')!;
    expect(clean(panel.querySelector('.empty')?.textContent)).toBe('Aucune notification.');
    expect(clean(panel.querySelector('.panel-head')?.textContent)).toBe('Notifications · Tout est lu');
  });
});

describe('Page Notifications', () => {
  let el: HTMLElement;
  let harness: RouterTestingHarness;
  const cards = () => [...el.querySelectorAll('ul[aria-label="Notifications"] li.row')];
  const markAllButton = () => [...el.querySelectorAll('button')].find((b) => clean(b.textContent) === 'Tout marquer comme lu');

  beforeEach(async () => {
    harness = await RouterTestingHarness.create('/notifications');
    el = harness.routeNativeElement!;
    http.expectOne(URL).flush(
      state(2, [
        item('n1', { kind: 'PERSONAL', message: '<img src=x onerror=alert(1)>\nMerci !' }),
        item('a1'),
        item('a0', { message: 'Ancienne', read: true }),
      ]),
    );
    await harness.fixture.whenStable();
  });

  it('liste en texte brut : type, non lue, bouton seulement sur les non lues', () => {
    expect(cards().map((c) => clean(c.querySelector('p')?.textContent)?.replace(/ · [^·]+ · /, ' · '))).toEqual([
      'Message de l’administrateur · Non lue',
      'Annonce · Non lue',
      expect.stringMatching(/^Annonce · \d/),
    ]);
    expect(cards()[0].querySelector('.message')?.textContent).toBe('<img src=x onerror=alert(1)>\nMerci !');
    expect(cards()[0].querySelector('img')).toBeNull();
    expect(cards().map((c) => !!c.querySelector('button'))).toEqual([true, true, false]);
    expect(cards().map((c) => c.classList.contains('unread-row'))).toEqual([true, true, false]);
    expect(cards()[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-15T08:00:00.000Z');
  });

  it('marquer comme lue : en cours, POST puis rechargement et confirmation', async () => {
    cards()[1].querySelector('button')!.click();
    await harness.fixture.whenStable();
    expect(clean(cards()[1].querySelector('button')?.textContent)).toMatch(/^Marquage en cours…/);
    expect(cards()[0].querySelector('button')?.disabled).toBe(true);
    const req = http.expectOne({ method: 'POST', url: `${URL}/a1/read` });
    req.flush(null, NO_CONTENT);
    http.expectOne(URL).flush(state(1, [item('n1', { kind: 'PERSONAL' }), item('a1', { read: true }), item('a0', { read: true })]));
    await harness.fixture.whenStable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Notification marquée comme lue.');
    expect(cards().map((c) => !!c.querySelector('button'))).toEqual([true, false, false]);
    expect(cards().map((c) => c.classList.contains('confirm-pop'))).toEqual([false, true, false]);
  });

  it('tout marquer comme lu : un POST par non lue puis rechargement', async () => {
    const all = markAllButton()!;
    all.click();
    await harness.fixture.whenStable();
    expect(clean(all.textContent)).toBe('Marquage en cours…');
    expect(all.disabled).toBe(true);
    http.expectOne({ method: 'POST', url: `${URL}/n1/read` }).flush(null, NO_CONTENT);
    http.expectOne({ method: 'POST', url: `${URL}/a1/read` }).flush(null, NO_CONTENT);
    http.expectOne(URL).flush(state(0, [item('n1', { kind: 'PERSONAL', read: true }), item('a1', { read: true }), item('a0', { read: true })]));
    await harness.fixture.whenStable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Toutes les notifications sont marquées comme lues.');
    expect(cards().map((c) => c.classList.contains('confirm-pop'))).toEqual([true, true, false]);
    expect(markAllButton()).toBeUndefined();
  });

  it('filtre Toutes / Non lues avec compteurs', async () => {
    const filters = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Filtrer les notifications"] button')];
    expect(filters.map((b) => clean(b.textContent))).toEqual(['Toutes (3)', 'Non lues (2)']);
    expect(filters[0].getAttribute('aria-pressed')).toBe('true');
    filters[1].click();
    await harness.fixture.whenStable();
    expect(filters[1].getAttribute('aria-pressed')).toBe('true');
    expect(cards().length).toBe(2);
  });

  it('notification disparue ⇒ message d’erreur', async () => {
    cards()[0].querySelector('button')!.click();
    http.expectOne(`${URL}/n1/read`).flush(null, { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toBe('Cette notification n’existe plus.');
    expect(cards()[0].querySelector('button')?.disabled).toBe(false);
  });
});

describe('Page Notifications : chargement et vide', () => {
  it('« Chargement… » puis état vide, sans filtre', async () => {
    const harness = await RouterTestingHarness.create('/notifications');
    const el = harness.routeNativeElement!;
    expect(clean(el.querySelector('[role="status"]')?.textContent)).toBe('Chargement…');
    http.expectOne(URL).flush(state(0));
    await harness.fixture.whenStable();
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(clean(el.querySelector('.empty')?.textContent)).toBe('Aucune notification.');
    expect(el.querySelector('[aria-label="Filtrer les notifications"]')).toBeNull();
  });
});
