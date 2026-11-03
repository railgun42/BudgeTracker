import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagDto } from '@budgetracker/shared';
import { provideApiHttp } from '../core/http';
import { TagInput } from './tag-input';

let http: HttpTestingController;
let fixture: ComponentFixture<TagInput>;
let el: HTMLElement;

const KNOWN: TagDto[] = [{ id: 'g1', name: 'Vacances' }];
const chips = () => [...el.querySelectorAll('.tag-chip > span')].map((s) => s.textContent);
const value = () => fixture.componentInstance.value();

async function enter(text: string): Promise<KeyboardEvent> {
  const input = el.querySelector<HTMLInputElement>('input')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  input.dispatchEvent(event);
  await fixture.whenStable();
  return event;
}

async function mount(selected: string[] = []): Promise<void> {
  fixture = TestBed.createComponent(TagInput);
  fixture.componentRef.setInput('tags', KNOWN);
  fixture.componentRef.setInput('value', selected);
  await fixture.whenStable();
  el = fixture.nativeElement;
}

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => http.verify());

describe('TagInput', () => {
  it('Entrée sur un tag existant (casse ignorée) le choisit sans requête et vide le champ', async () => {
    await mount();
    const event = await enter('  vACANCES ');
    expect(event.defaultPrevented).toBe(true);
    expect(value()).toEqual(['g1']);
    expect(chips()).toEqual(['Vacances']);
    expect(el.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Tag Vacances ajouté.');
  });

  it('Entrée sur un nouveau nom : POST /tags puis puce', async () => {
    await mount();
    await enter('Cadeau');
    const req = http.expectOne('/api/v1/tags');
    expect(req.request.body).toEqual({ name: 'Cadeau' });
    req.flush({ id: 'g2', name: 'Cadeau' });
    await fixture.whenStable();
    expect(value()).toEqual(['g2']);
    expect(fixture.componentInstance.tags().map((t) => t.name)).toEqual(['Vacances', 'Cadeau']);
  });

  it('doublon (casse ignorée) ignoré : une seule puce, annonce du doublon', async () => {
    await mount(['g1']);
    await enter('vacances');
    expect(value()).toEqual(['g1']);
    expect(chips()).toEqual(['Vacances']);
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Le tag Vacances est déjà ajouté.');
  });

  it('champ vide ou espaces ⇒ ignoré, sans requête', async () => {
    await mount();
    await enter('   ');
    expect(value()).toEqual([]);
  });

  it('la croix retire la puce (nom accessible explicite) et l’annonce', async () => {
    await mount(['g1']);
    const cross = el.querySelector<HTMLButtonElement>('.tag-chip button')!;
    expect(cross.getAttribute('aria-label')).toBe('Retirer le tag Vacances');
    cross.click();
    await fixture.whenStable();
    expect(value()).toEqual([]);
    expect(chips()).toEqual([]);
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Tag Vacances retiré.');
  });

  it('création refusée (409) ⇒ message, aucune puce ajoutée', async () => {
    await mount();
    await enter('Cadeau');
    http.expectOne('/api/v1/tags').flush(null, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(value()).toEqual([]);
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('existe déjà');
  });

  it('20 tags au maximum : le suivant est refusé sans requête', async () => {
    const full = Array.from({ length: 20 }, (_, i) => `x${i}`);
    await mount(full);
    await enter('Nouveau');
    expect(value()).toEqual(full);
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('20 tags');
  });

  it('accessibilité : champ relié à son libellé, aide et liste de suggestions', async () => {
    await mount();
    const input = el.querySelector('input')!;
    expect(el.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(el.querySelector(`#${input.getAttribute('aria-describedby')}`)).not.toBeNull();
    expect([...el.querySelectorAll(`#${input.getAttribute('list')} option`)].map((o) => o.getAttribute('value'))).toEqual(['Vacances']);
  });
});
