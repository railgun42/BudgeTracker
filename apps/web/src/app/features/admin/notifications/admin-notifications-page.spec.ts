import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { addDays } from '@budgetracker/shared';
import { routes } from '../../../app.routes';
import { Session } from '../../../core/auth/session';
import { provideApiHttp } from '../../../core/http';
import { today } from '../../../core/today';
import { termsMessage } from './admin-notifications-page';

const ADMIN = { id: 'u1', email: 'admin@example.com', name: 'Admin', lastConnection: null, role: 'ADMIN' };
const SENT = { id: 's1', message: 'x', createdAt: '2026-10-15T08:00:00.000Z' };

let http: HttpTestingController;
let el: HTMLElement;
let harness: RouterTestingHarness;

const stable = () => harness.fixture.whenStable();
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim();
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => el.querySelector<T>(`#${id}`)!;
const submit = (i: number) => el.querySelectorAll('form')[i].dispatchEvent(new Event('submit'));

function type(id: string, value: string): void {
  const input = field<HTMLInputElement | HTMLTextAreaElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(ADMIN);
  await restored;
  harness = await RouterTestingHarness.create('/admin/notifications');
  el = harness.routeNativeElement!;
  await stable();
});

afterEach(() => http.verify());

describe('Administration : notifications et annonces', () => {
  it('rappelle que l’annonce ne remplace pas l’e-mail RGPD', () => {
    expect(clean(el.querySelector('#gdpr-reminder')?.textContent)).toMatch(/^Une annonce ne remplace pas l'e-mail\. .*obligatoire \(RGPD\)/);
  });

  it('annonce : message rogné envoyé, formulaire vidé ; vide ⇒ aucune requête', async () => {
    type('announcement-message', '   ');
    submit(0);
    http.expectNone('/api/v1/admin/announcements');
    await stable();
    expect(field('announcement-message').getAttribute('aria-invalid')).toBe('true');

    type('announcement-message', '  Nouvelle catégorie « Aide sociale »  ');
    submit(0);
    const req = http.expectOne({ method: 'POST', url: '/api/v1/admin/announcements' });
    expect(req.request.body).toEqual({ message: 'Nouvelle catégorie « Aide sociale »' });
    req.flush(SENT);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Annonce envoyée à tous les utilisateurs.');
    expect(field<HTMLTextAreaElement>('announcement-message').value).toBe('');
  });

  it('modification des CGU : préavis de 30 jours par défaut, message prérempli, alerte si préavis trop court', async () => {
    expect(el.querySelector('#announcement-effective')).toBeNull();
    const terms = field('announcement-terms');
    terms.click();
    await stable();
    const effective = addDays(today(), 30);
    expect(field('announcement-effective').value).toBe(effective);
    expect(field<HTMLTextAreaElement>('announcement-message').value).toBe(termsMessage(effective));
    expect(termsMessage('2026-11-14')).toContain('entrera en vigueur le 14/11/2026');
    expect(termsMessage('2026-11-14')).toContain('Aucune action n\'est nécessaire');
    expect(clean(el.querySelector('#announcement-effective-hint')?.textContent)).toMatch(/^Préavis de 30 jours au moins/);

    type('announcement-effective', addDays(today(), 10));
    await stable();
    expect(clean(el.querySelector('#announcement-effective-hint')?.textContent)).toBe('Préavis inférieur à 30 jours.');
    expect(field<HTMLTextAreaElement>('announcement-message').value).toBe(termsMessage(addDays(today(), 10)));

    submit(0);
    expect(http.expectOne('/api/v1/admin/announcements').request.body).toEqual({ message: termsMessage(addDays(today(), 10)) });
  });

  it('notification ciblée : e-mail et message envoyés ; e-mail inconnu ⇒ message clair', async () => {
    submit(1);
    http.expectNone('/api/v1/admin/notifications');

    type('notification-email', ' bob@example.com ');
    type('notification-message', 'Merci pour ton retour');
    submit(1);
    const req = http.expectOne({ method: 'POST', url: '/api/v1/admin/notifications' });
    expect(req.request.body).toEqual({ email: 'bob@example.com', message: 'Merci pour ton retour' });
    req.flush({ message: 'Aucun utilisateur avec cet e-mail' }, { status: 404, statusText: 'Not Found' });
    await stable();
    expect(clean(el.querySelector('[role="alert"]')?.textContent)).toBe('Aucun utilisateur avec cet e-mail.');

    submit(1);
    http.expectOne('/api/v1/admin/notifications').flush(SENT);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Notification envoyée.');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
