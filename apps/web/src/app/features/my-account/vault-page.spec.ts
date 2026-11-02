import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DocumentDto } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { filterDocuments } from './vault-page';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null, createdAt: '2026-10-03T09:00:00.000Z' };
const STORAGE = { usedBytes: 3 * 1024 * 1024, quotaBytes: 200 * 1024 * 1024 };
const TAGS = [
  { id: 'g1', name: 'Impôts' },
  { id: 'g2', name: 'Maison' },
];
const doc = (id: string, over: Partial<DocumentDto> = {}): DocumentDto => ({
  id,
  originalName: `${id}.pdf`,
  mime: 'application/pdf',
  sizeBytes: 2048,
  createdAt: '2026-10-01T10:00:00.000Z',
  tagIds: [],
  transaction: null,
  ...over,
});
const DOCS = [
  doc('d1', { originalName: 'Ticket courses.png', mime: 'image/png', tagIds: ['g2'], transaction: { id: 't1', name: 'Courses', date: '2026-06-01', accountId: 'a1' } }),
  doc('d2', { originalName: '<img src=x onerror=alert(1)>.pdf', createdAt: '2026-10-02T10:00:00.000Z', tagIds: ['g1', 'g2'], sizeBytes: 3 * 1024 * 1024 }),
];

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const stable = () => harness.fixture.whenStable();
const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
/** Une ligne par document : nom, détails, transaction et tags, séparés par une espace. */
const rows = () =>
  [...el.querySelectorAll('li.row')].map((li) =>
    [...li.querySelectorAll('.row-main > strong, .row-main > span, .badge')].map((n) => n.textContent!.replace(/\s+/g, ' ').trim()).join(' '),
  );
const button = (label: string, root: ParentNode = el) => [...root.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').includes(label))!;
const dialogOf = (id: string) => el.querySelector(`#${id}`)!.closest('dialog')!;

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
}

/** Documents, tags puis espace utilisé. */
async function flushLoad(docs = DOCS, tags = TAGS): Promise<void> {
  http.expectOne('/api/v1/documents').flush(docs);
  http.expectOne('/api/v1/tags').flush(tags);
  http.expectOne('/api/v1/me/storage').flush(STORAGE);
  await stable();
}

describe('filterDocuments', () => {
  const all = { q: '', type: '', tagId: '', sort: 'recent' as const };
  it('recherche par nom (casse ignorée), type, tag', () => {
    expect(filterDocuments(DOCS, { ...all, q: 'TICKET' }).map((d) => d.id)).toEqual(['d1']);
    expect(filterDocuments(DOCS, { ...all, type: 'image' }).map((d) => d.id)).toEqual(['d1']);
    expect(filterDocuments(DOCS, { ...all, type: 'application/pdf' }).map((d) => d.id)).toEqual(['d2']);
    expect(filterDocuments(DOCS, { ...all, tagId: 'g1' }).map((d) => d.id)).toEqual(['d2']);
  });
  it('tris : récents, anciens, nom, taille, type ; la liste d’origine reste intacte', () => {
    const ids = (sort: 'recent' | 'old' | 'name' | 'size' | 'type') => filterDocuments(DOCS, { ...all, sort }).map((d) => d.id);
    expect(ids('recent')).toEqual(['d2', 'd1']);
    expect(ids('old')).toEqual(['d1', 'd2']);
    expect(ids('name')).toEqual(['d2', 'd1']);
    expect(ids('size')).toEqual(['d2', 'd1']);
    expect(ids('type')).toEqual(['d2', 'd1']); // PDF avant PNG
    expect(DOCS.map((d) => d.id)).toEqual(['d1', 'd2']);
  });
});

describe('Coffre-fort', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const restored = TestBed.inject(Session).restore();
    http.expectOne('/api/v1/me').flush(USER);
    await restored;
    harness = await RouterTestingHarness.create('/me/coffre');
    el = harness.routeNativeElement!;
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('chargement, puis lignes : nom en texte brut, type, taille, date, transaction liée, tags ; espace utilisé', async () => {
    expect(el.textContent).toContain('Chargement des documents…');
    await flushLoad();
    expect(rows()).toEqual([
      expect.stringMatching(/^<img src=x onerror=alert\(1\)>\.pdf PDF · 3 Mo · ajouté le 2 oct\. 2026 Déposé dans le coffre Impôts Maison/),
      expect.stringMatching(/^Ticket courses\.png PNG · 2 ko · ajouté le 1 oct\. 2026 Transaction : Courses du 1 juin 2026 Maison/),
    ]);
    expect(el.querySelector('.rows img')).toBeNull(); // le nom n'est jamais interprété comme HTML
    expect(el.querySelector<HTMLAnchorElement>('.rows a')!.getAttribute('href')).toBe('/history?from=2026-06-01&to=2026-06-01&accountId=a1');
    expect(text('.usage')).toContain('3 Mo utilisés sur 200 Mo (2 %)');
    expect(text('.list-head')).toContain('2 documents');
  });

  it('filtres : compteur « 1 document sur 2 », aucun résultat ⇒ « Effacer les filtres »', async () => {
    await flushLoad();
    type('v-tag', 'g1');
    await stable();
    expect(rows()).toHaveLength(1);
    expect(text('.list-head')).toContain('1 document sur 2');
    type('v-q', 'introuvable');
    await stable();
    expect(el.textContent).toContain('Aucun document ne correspond aux filtres.');
    button('Effacer les filtres').click();
    await stable();
    expect(rows()).toHaveLength(2);
  });

  it('vide : invitation à déposer ou joindre un justificatif', async () => {
    await flushLoad([]);
    expect(el.textContent).toContain('Aucun document. Déposez-en un ci-dessus');
  });

  it('erreur de chargement : message et « Recharger »', async () => {
    http.expectOne('/api/v1/documents').flush(null, { status: 500, statusText: 'Error' });
    http.expectOne('/api/v1/tags'); // annulée par forkJoin après l'échec
    http.expectOne('/api/v1/me/storage').flush(null, { status: 500, statusText: 'Error' });
    await stable();
    expect(text('[role="alert"]')).toContain('indisponible');
    expect(el.textContent).toContain('Espace utilisé indisponible');
    button('Recharger').click();
    await flushLoad();
    expect(rows()).toHaveLength(2);
  });

  it('dépôt : envoi multipart, « Envoi en cours… », puis confirmation et liste rechargée ; quota plein ⇒ message', async () => {
    await flushLoad();
    const input = el.querySelector<HTMLInputElement>('#vault-file')!;
    const pick = (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    pick(new File(['%PDF-'], 'contrat.pdf', { type: 'application/pdf' }));
    await stable();
    expect(el.textContent).toContain('Envoi en cours…');
    const req = http.expectOne('/api/v1/documents');
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.flush({ id: 'd3', originalName: 'contrat.pdf', mime: 'application/pdf', sizeBytes: 5 });
    await flushLoad([...DOCS, doc('d3')]);
    expect(text('.alert-success')).toBe('Document ajouté au coffre.');
    expect(rows()).toHaveLength(3);

    pick(new File(['%PDF-'], 'gros.pdf', { type: 'application/pdf' }));
    http.expectOne('/api/v1/documents').flush(null, { status: 422, statusText: 'Unprocessable' });
    await stable();
    expect(text('#vault-file-error')).toContain('Espace de stockage plein');

    pick(new File(['MZ'], 'virus.exe', { type: 'application/x-msdownload' }));
    await stable();
    expect(text('#vault-file-error')).toContain('Format non accepté');
  });

  it('aperçu : image dans une modale ; PDF dans un nouvel onglet', async () => {
    await flushLoad();
    button('Aperçu de Ticket courses.png').click();
    http.expectOne('/api/v1/documents/d1/url').flush({ url: 'https://s3.example/d1' });
    await stable();
    expect(dialogOf('preview-title').hasAttribute('open')).toBe(true);
    expect(el.querySelector<HTMLImageElement>('.preview img')!.getAttribute('src')).toBe('https://s3.example/d1');
    expect(el.querySelector<HTMLImageElement>('.preview img')!.alt).toBe('Aperçu de Ticket courses.png');
    button('Fermer', dialogOf('preview-title')).click();
    await stable();

    const tab = { opener: window as unknown, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    button('Aperçu de <img').click();
    http.expectOne('/api/v1/documents/d2/url').flush({ url: 'https://s3.example/d2' });
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://s3.example/d2');
  });

  it('télécharger : URL signée en download=1 suivie par un lien ; 404 ⇒ message', async () => {
    await flushLoad();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    button('Télécharger Ticket').click();
    const req = http.expectOne((r) => r.url === '/api/v1/documents/d1/url');
    expect(req.request.params.get('download')).toBe('1');
    req.flush({ url: 'https://s3.example/d1?dl' });
    expect(click).toHaveBeenCalledTimes(1);

    button('Télécharger Ticket').click();
    http.expectOne((r) => r.url === '/api/v1/documents/d1/url').flush(null, { status: 404, statusText: 'Not Found' });
    await stable();
    expect(text('[role="alert"]')).toContain('Ce document n’existe plus');
  });

  it('tags : cases pré-cochées, création d’un tag (coché), enregistrement de l’ensemble', async () => {
    await flushLoad();
    button('Tags de Ticket').click();
    await stable();
    const dialog = dialogOf('tags-title');
    expect(dialog.hasAttribute('open')).toBe(true);
    const boxes = () => [...dialog.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((c) => [c.parentElement!.textContent!.trim(), c.checked]);
    expect(boxes()).toEqual([
      ['Impôts', false],
      ['Maison', true],
    ]);

    type('new-tag', '  Garantie ');
    await stable();
    button('Créer le tag', dialog).click();
    const create = http.expectOne('/api/v1/tags');
    expect(create.request.body).toEqual({ name: 'Garantie' });
    create.flush({ id: 'g3', name: 'Garantie' });
    await stable();
    expect(boxes()).toEqual([
      ['Garantie', true],
      ['Impôts', false],
      ['Maison', true],
    ]);

    button('Enregistrer les tags', dialog).click();
    const put = http.expectOne('/api/v1/documents/d1/tags');
    expect(put.request.method).toBe('PUT');
    expect([...put.request.body.tagIds].sort()).toEqual(['g2', 'g3']);
    put.flush({ ...DOCS[0], tagIds: ['g2', 'g3'] });
    await stable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(text('.alert-success')).toBe('Tags enregistrés.');
    expect(rows()[1]).toContain('Maison Garantie');
  });

  it('gérer les tags : renommer, nom déjà pris ⇒ erreur dans la modale, supprimer après confirmation', async () => {
    await flushLoad();
    button('Gérer les tags').click();
    await stable();
    const dialog = dialogOf('manage-title');
    expect(button('Renommer Impôts', dialog).disabled).toBe(true); // nom inchangé
    type('rename-g1', 'Maison');
    await stable();
    button('Renommer Impôts', dialog).click();
    http.expectOne('/api/v1/tags/g1').flush(null, { status: 409, statusText: 'Conflict' });
    await stable();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Un tag porte déjà ce nom.');

    type('rename-g1', 'Taxes');
    await stable();
    button('Renommer Impôts', dialog).click();
    const patch = http.expectOne('/api/v1/tags/g1');
    expect(patch.request.body).toEqual({ name: 'Taxes' });
    patch.flush({ id: 'g1', name: 'Taxes' });
    await stable();

    button('Supprimer le tag Maison', dialog).click();
    await stable();
    button('Confirmer la suppression de Maison', dialog).click();
    http.expectOne('/api/v1/tags/g2').flush(null);
    await stable();
    button('Fermer', dialog).click();
    await stable();
    expect(rows()[0]).toContain('Taxes');
    expect(rows().join(' ')).not.toContain('Maison');
  });

  it('supprimer : modale qui prévient pour la transaction liée, puis ligne retirée et espace relu', async () => {
    await flushLoad();
    button('Supprimer Ticket').click();
    await stable();
    const dialog = dialogOf('delete-title');
    expect(dialog.textContent).toContain('La transaction liée reste, sans ce justificatif.');
    button('Supprimer définitivement le document', dialog).click();
    await stable();
    expect(dialog.textContent).toContain('Suppression en cours…');
    const req = http.expectOne('/api/v1/documents/d1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    http.expectOne('/api/v1/me/storage').flush({ ...STORAGE, usedBytes: 0 });
    await stable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(rows()).toHaveLength(1);
    expect(text('.alert-success')).toBe('Document supprimé.');
  });
});
