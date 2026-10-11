import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('Shell', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it('affiche la navigation principale et un lien d’évitement', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const nav = el.querySelector('nav[aria-label="Navigation principale"]');
    const links = [...nav!.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['Tableau de bord', '/'],
      ['Comptes', '/accounts'],
      ['Historique', '/history'],
      ['Statistiques', '/stats'],
      ['Simulations', '/simulations'],
    ]);
    expect(el.querySelector('.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('main#main router-outlet')).not.toBeNull();
  });

  it('marque le lien actif avec aria-current', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/history');
    await fixture.whenStable();
    const current = (fixture.nativeElement as HTMLElement).querySelectorAll('[aria-current="page"]');
    expect([...current].map((a) => a.textContent?.trim())).toEqual(['Historique']);
  });
});

describe('Routes', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it.each([
    ['/', 'Tableau de bord'],
    ['/accounts', 'Mes comptes'],
    ['/transactions/new', 'Ajouter une transaction'],
    ['/history', 'Historique des transactions'],
    ['/stats', 'Statistiques'],
    ['/simulations', 'Simulations'],
    ['/login', 'Connexion'],
    ['/signup', 'Créer un compte'],
    ['/nimporte/quoi', 'Page introuvable'],
  ])('%s charge son écran en lazy et fixe le titre « %s »', async (url, title) => {
    const harness = await RouterTestingHarness.create(url);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(title);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
  });

  it('toutes les routes sont en lazy loading', () => {
    expect(routes.every((r) => r.loadComponent && !r.component)).toBe(true);
  });
});
