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
const dialog = () => el.querySelector<HTMLDialogElement>('dialog')!;
const inDialog = (label: string) => [...dialog().querySelectorAll('button')].find((b) => clean(b.textContent) === label)!;
const confirmSend = () => inDialog('Confirmer l’envoi à tous').click();
const card = (i: number) => el.querySelectorAll('section.card')[i];

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

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
    http.expectNone('/api/v1/admin/announcements'); // récapitulatif d'abord
    expect(dialog().hasAttribute('open')).toBe(true);
    confirmSend();
    const req = http.expectOne({ method: 'POST', url: '/api/v1/admin/announcements' });
    expect(req.request.body).toEqual({ message: 'Nouvelle catégorie « Aide sociale »' });
    req.flush(SENT);
    await stable();
    expect(clean(el.querySelector('[aria-live]')?.textContent)).toBe('Annonce envoyée à tous les utilisateurs.');
    expect(el.querySelector('[aria-live] .alert-success.confirm-pop')).not.toBeNull();
    expect(field<HTMLTextAreaElement>('announcement-message').value).toBe('');
    expect(dialog().hasAttribute('open')).toBe(false);
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
    // Avertissement écrit avec icône, pas une erreur : ni rouge ni aria-invalid.
    expect(el.querySelector('#announcement-effective-hint')?.className).toBe('field-warning');
    expect(el.querySelector('#announcement-effective-hint svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(field('announcement-effective').hasAttribute('aria-invalid')).toBe(false);
    expect(field<HTMLTextAreaElement>('announcement-message').value).toBe(termsMessage(addDays(today(), 10)));

    submit(0);
    await stable();
    expect(clean(dialog().textContent)).toContain('Préavis inférieur à 30 jours.');
    confirmSend();
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

  it('date d’entrée en vigueur écrite en clair à côté du champ', async () => {
    field('announcement-terms').click();
    await stable();
    type('announcement-effective', '2026-11-15');
    await stable();
    expect(clean(el.querySelector('#announcement-effective-date')?.textContent)).toBe('Entrée en vigueur le 15 nov. 2026.');
    expect(el.querySelector('#announcement-effective-date time')?.getAttribute('datetime')).toBe('2026-11-15');
    expect(field('announcement-effective').getAttribute('aria-describedby')).toBe('announcement-effective-date announcement-effective-hint');
  });

  it('modale récapitulative : aperçu, Annuler sans envoi, erreur gardée dans la modale, envoi en cours', async () => {
    type('announcement-message', '  Maintenance dimanche  ');
    submit(0);
    await stable();
    expect(dialog().getAttribute('aria-labelledby')).toBe('announce-dialog-title');
    expect(clean(dialog().querySelector('.preview .message')?.textContent)).toBe('Maintenance dimanche');
    expect(clean(dialog().querySelector('.preview .row-head')?.textContent)).toContain('Annonce');

    inDialog('Annuler').click();
    expect(dialog().hasAttribute('open')).toBe(false);
    http.expectNone('/api/v1/admin/announcements');

    submit(0);
    confirmSend();
    await stable();
    const busy = [...dialog().querySelectorAll('button')].find((b) => clean(b.textContent) === 'Envoi en cours…')!;
    expect(busy.disabled).toBe(true);
    http.expectOne('/api/v1/admin/announcements').flush({ message: 'x' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(clean(dialog().querySelector('[role="alert"]')?.textContent)).toMatch(/^Message vide ou trop long/);
    expect(el.querySelector('[aria-live] .alert-success')).toBeNull();
  });

  it('compteur n / max, ton d’avertissement à 90 % de la limite', async () => {
    const count = () => el.querySelector('#announcement-message-count')!;
    expect(clean(count().textContent)).toBe('0 / 2000 caractères.');
    expect(count().className).toBe('field-hint');
    expect(field('announcement-message').getAttribute('aria-describedby')).toBe('announcement-message-hint announcement-message-count');

    type('announcement-message', 'a'.repeat(1950));
    await stable();
    expect(count().className).toBe('field-warning');
    expect(clean(count().textContent)).toBe('1950 / 2000 caractères : plus que 50.');
  });

  it('notification ciblée : aperçu « Message de l’administrateur », e-mail invalide signalé et relié', async () => {
    expect(card(1).querySelector('.preview')).toBeNull();
    type('notification-message', 'Bonjour');
    submit(1);
    await stable();
    expect(clean(card(1).querySelector('.preview .row-head')?.textContent)).toContain('Message de l’administrateur');
    expect(clean(card(1).querySelector('.preview .unread-mark')?.textContent)).toBe('Non lue');
    expect(field('notification-email').getAttribute('aria-invalid')).toBe('true');
    expect(field('notification-email').getAttribute('aria-describedby')).toBe('notification-email-hint');
    expect(el.querySelector('#notification-email-hint')?.className).toBe('field-error');
    expect(clean(el.querySelector('#notification-message-count')?.textContent)).toBe('7 / 2000 caractères.');
  });

  it('cartes titrées avec icône décorative', () => {
    expect(clean(card(0).querySelector('h2')?.textContent)).toBe('Annonce à tous');
    expect(clean(card(1).querySelector('h2')?.textContent)).toBe('Notification à un utilisateur');
    expect(card(0).querySelector('h2 svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
