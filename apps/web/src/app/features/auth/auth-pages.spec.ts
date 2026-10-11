import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const status = (code: number) => ({ status: code, statusText: String(code) });

let harness: RouterTestingHarness;
let http: HttpTestingController;

async function open(url: string): Promise<HTMLElement> {
  harness = await RouterTestingHarness.create(url);
  return harness.routeNativeElement!;
}

function type(el: HTMLElement, id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

async function submit(el: HTMLElement): Promise<void> {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  await harness.fixture.whenStable();
}

const text = (el: HTMLElement, selector: string) => el.querySelector(selector)?.textContent?.trim();

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => http.verify());

describe('Connexion', () => {
  it('formulaire invalide ⇒ aucune requête, erreurs reliées aux champs', async () => {
    const el = await open('/login');
    await submit(el);

    http.expectNone('/api/v1/auth/login');
    const email = el.querySelector('#login-email')!;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector(`#${email.getAttribute('aria-describedby')}`)?.textContent).toContain('adresse e-mail valide');
    expect(el.querySelector('label[for="login-password"]')).not.toBeNull();
  });

  it('succès ⇒ session posée puis retour à returnUrl', async () => {
    const el = await open('/login?returnUrl=%2Fhistory');
    type(el, 'login-email', 'alice@example.com');
    type(el, 'login-password', 'motdepasse-solide');
    await submit(el);

    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.body).toEqual({ email: 'alice@example.com', password: 'motdepasse-solide' });
    req.flush(USER);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Session).user()).toEqual(USER);
    expect(TestBed.inject(Router).url).toBe('/history');
  });

  it.each([
    [401, 'Adresse e-mail ou mot de passe incorrect.'],
    [403, 'Adresse e-mail non vérifiée : ouvrez le lien reçu par e-mail.'],
    [429, 'Trop de tentatives. Réessayez dans quelques minutes.'],
  ])('%i ⇒ « %s »', async (code, message) => {
    const el = await open('/login');
    type(el, 'login-email', 'alice@example.com');
    type(el, 'login-password', 'x');
    await submit(el);
    http.expectOne('/api/v1/auth/login').flush(null, status(code));
    await harness.fixture.whenStable();

    expect(text(el, '[role="alert"]')).toBe(message);
    expect(TestBed.inject(Session).user()).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('bouton Google : navigation pleine page vers l’API', async () => {
    const el = await open('/login');
    const google = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Google'));
    expect(google?.getAttribute('href')).toBe('/api/v1/auth/google');
  });

  it('retour Google refusé (?error=google_link_refused) ⇒ explication', async () => {
    const el = await open('/login?error=google_link_refused');
    expect(text(el, '[role="alert"]')).toContain('adresse Google doit être vérifiée');
  });
});

describe('Inscription', () => {
  it('mot de passe trop court ⇒ aucune requête', async () => {
    const el = await open('/signup');
    type(el, 'signup-email', 'bob@example.com');
    type(el, 'signup-name', 'Bob');
    type(el, 'signup-password', 'court');
    await submit(el);

    http.expectNone('/api/v1/auth/signup');
    expect(el.querySelector('#signup-password')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#signup-password-hint')!.className).toBe('field-error');
  });

  it('e-mail + nom + mot de passe ⇒ POST /auth/signup puis invitation à vérifier l’e-mail', async () => {
    const el = await open('/signup');
    type(el, 'signup-email', 'bob@example.com');
    type(el, 'signup-name', 'Bob');
    type(el, 'signup-password', 'motdepasse-solide');
    await submit(el);

    const req = http.expectOne('/api/v1/auth/signup');
    expect(req.request.body).toEqual({ email: 'bob@example.com', name: 'Bob', password: 'motdepasse-solide' });
    req.flush(null, status(202));
    await harness.fixture.whenStable();

    expect(text(el, '[role="status"]')).toContain('lien de confirmation');
    expect(el.querySelector('form')).toBeNull();
  });
});

describe('Vérification d’e-mail', () => {
  it('envoie le jeton du lien et confirme', async () => {
    const el = await open('/verify-email?token=jeton-1');
    const req = http.expectOne('/api/v1/auth/verify-email');
    expect(req.request.body).toEqual({ token: 'jeton-1' });
    req.flush(null, status(204));
    await harness.fixture.whenStable();

    expect(text(el, '[role="status"]')).toContain('adresse est confirmée');
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('jeton invalide ou expiré (400) ⇒ message', async () => {
    const el = await open('/verify-email?token=perime');
    http.expectOne('/api/v1/auth/verify-email').flush(null, status(400));
    await harness.fixture.whenStable();
    expect(text(el, '[role="alert"]')).toBe('Ce lien est invalide, déjà utilisé ou expiré.');
  });

  it('sans jeton ⇒ aucune requête', async () => {
    const el = await open('/verify-email');
    http.expectNone('/api/v1/auth/verify-email');
    expect(text(el, '[role="alert"]')).toContain('Lien de vérification incomplet');
  });
});

describe('Mot de passe oublié / reset', () => {
  it('forgot ⇒ POST /auth/forgot puis message neutre', async () => {
    const el = await open('/forgot-password');
    type(el, 'forgot-email', 'alice@example.com');
    await submit(el);

    const req = http.expectOne('/api/v1/auth/forgot');
    expect(req.request.body).toEqual({ email: 'alice@example.com' });
    req.flush(null, status(202));
    await harness.fixture.whenStable();
    expect(text(el, '[role="status"]')).toContain('Si un compte correspond');
  });

  it('reset ⇒ POST /auth/reset avec le jeton du lien', async () => {
    const el = await open('/reset-password?token=jeton-2');
    type(el, 'reset-password', 'nouveau-motdepasse');
    await submit(el);

    const req = http.expectOne('/api/v1/auth/reset');
    expect(req.request.body).toEqual({ token: 'jeton-2', password: 'nouveau-motdepasse' });
    req.flush(null, status(204));
    await harness.fixture.whenStable();
    expect(text(el, '[role="status"]')).toContain('Mot de passe modifié');
  });

  it('reset avec jeton déjà utilisé (400) ⇒ message et lien pour en redemander un', async () => {
    const el = await open('/reset-password?token=use');
    type(el, 'reset-password', 'nouveau-motdepasse');
    await submit(el);
    http.expectOne('/api/v1/auth/reset').flush(null, status(400));
    await harness.fixture.whenStable();

    expect(text(el, '[role="alert"]')).toBe('Ce lien est invalide, déjà utilisé ou expiré.');
    expect(el.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('reset sans jeton ⇒ pas de formulaire', async () => {
    const el = await open('/reset-password');
    expect(el.querySelector('form')).toBeNull();
    expect(text(el, '[role="alert"]')).toContain('Lien incomplet');
  });
});
