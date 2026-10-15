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
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/notifications');
    expect(link.getAttribute('aria-label')).toBe('Notifications (3 non lues)');
    expect(clean(el.querySelector('.badge')?.textContent)).toBe('3');

    await TestBed.inject(Router).navigateByUrl('/me');
    http.expectOne(URL).flush(state(1));
    await fixture.whenStable();
    expect(link.getAttribute('aria-label')).toBe('Notifications (1 non lue)');
    expect(clean(el.querySelector('.badge')?.textContent)).toBe('1');

    await TestBed.inject(Router).navigateByUrl('/stats');
    http.expectOne(URL).flush(state(0));
    await fixture.whenStable();
    expect(link.getAttribute('aria-label')).toBe('Notifications');
    expect(el.querySelector('.badge')).toBeNull();
  });

  it('au-delà de 99 : « 99+ »', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    http.expectOne(URL).flush(state(120));
    await fixture.whenStable();
    expect(clean((fixture.nativeElement as HTMLElement).querySelector('.badge')?.textContent)).toBe('99+');
  });
});

describe('Page Notifications', () => {
  let el: HTMLElement;
  let harness: RouterTestingHarness;
  const cards = () => [...el.querySelectorAll('ul[aria-label="Notifications"] li.card')];

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
  });

  it('marquer comme lue : POST puis rechargement', async () => {
    cards()[1].querySelector('button')!.click();
    const req = http.expectOne({ method: 'POST', url: `${URL}/a1/read` });
    req.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(URL).flush(state(1, [item('n1', { kind: 'PERSONAL' }), item('a1', { read: true }), item('a0', { read: true })]));
    await harness.fixture.whenStable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Notification marquée comme lue.');
    expect(cards().map((c) => !!c.querySelector('button'))).toEqual([true, false, false]);
  });

  it('notification disparue ⇒ message d’erreur', async () => {
    cards()[0].querySelector('button')!.click();
    http.expectOne(`${URL}/n1/read`).flush(null, { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toBe('Cette notification n’existe plus.');
  });
});
