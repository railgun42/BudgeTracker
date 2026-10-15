import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { provideApiHttp } from '../../core/http';

let http: HttpTestingController;

async function open(url: string): Promise<HTMLElement> {
  const harness = await RouterTestingHarness.create(url);
  return harness.routeNativeElement!;
}

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => http.verify());

describe('Pages légales', () => {
  it.each([
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'Politique de confidentialité'],
    ['/cgu', 'Conditions générales d’utilisation'],
  ])('%s accessible sans connexion (aucun appel à /me, pas de redirection)', async (url, title) => {
    const el = await open(url);
    expect(el.querySelector('h1')?.textContent).toBe(title);
    expect(TestBed.inject(Router).url).toBe(url);
    http.expectNone('/api/v1/me');
  });

  it('mentions légales : éditeur, contact et hébergeur OVH', async () => {
    const text = (await open('/mentions-legales')).textContent!;
    expect(text).toContain('Éditeur');
    expect(text).toContain('Contact');
    expect(text).toContain('OVH SAS, 2 rue Kellermann, 59100 Roubaix');
  });

  it('confidentialité : finalités, durées de 30 jours et limite d’accès de l’administrateur', async () => {
    const el = await open('/confidentialite');
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Finalités et bases légales');
    expect(text).toContain('récupérables 30 jours, puis effacés définitivement');
    expect(text).toContain('sauvegardes chiffrées qui les contiennent expirent sous 30 jours');
    expect(text).toContain('L’administrateur du service peut donc techniquement y accéder');
    expect(text).toContain('Retours (« Donner mon avis ») : 30 jours après leur traitement, 90 jours au plus');
    expect(text).toContain('Suggestions de catégorie : jusqu’à la suppression de votre compte.');
    expect(text).toContain('Notifications et état de lecture des annonces : jusqu’à la suppression de votre compte');
    expect(text).toContain('OVH');
    expect(el.querySelector('a[href="/me"]')).not.toBeNull();
  });

  it('CGU : renvoie à la politique de confidentialité', async () => {
    const el = await open('/cgu');
    expect(el.querySelector('a[href="/confidentialite"]')).not.toBeNull();
  });
});
