import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AttachmentDto, TransactionDto, TransactionType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { AttachmentControl } from './attachment-control';

const PATH = '/api/v1/transactions/t1/attachment';
const FILE: AttachmentDto = { id: 'f1', originalName: 'facture.pdf', mime: 'application/pdf', sizeBytes: 2048 };
const tx = (attachment: AttachmentDto | null = null): TransactionDto => ({
  id: 't1',
  accountId: 'a1',
  name: 'Marché',
  date: '2026-10-01',
  amountCents: 1234,
  type: TransactionType.DEBIT,
  details: null,
  categoryId: 'c1',
  tagIds: [],
  transferId: null,
  recurrenceId: null,
  attachment,
  version: 1,
});
const status = (code: number) => ({ status: code, statusText: String(code) });

let http: HttpTestingController;
let fixture: ComponentFixture<AttachmentControl>;
let el: HTMLElement;
let emitted: (AttachmentDto | null)[];

const text = () => el.textContent!.replace(/\s+/g, ' ').trim();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

async function mount(attachment: AttachmentDto | null = null): Promise<void> {
  fixture = TestBed.createComponent(AttachmentControl);
  fixture.componentRef.setInput('transaction', tx(attachment));
  emitted = [];
  fixture.componentInstance.changed.subscribe((a) => emitted.push(a));
  el = fixture.nativeElement;
  await fixture.whenStable();
}

/** Simule le choix d'un fichier dans l'input. */
async function choose(file: File): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await fixture.whenStable();
}

const pdf = (size = 100) => new File([new Uint8Array(size)], 'facture.pdf', { type: 'application/pdf' });

describe('Pièce jointe d’une transaction', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideApiHttp(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('sans pièce : champ fichier libellé, limité aux formats acceptés', async () => {
    await mount();
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(el.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('Joindre un justificatif');
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,application/pdf');
  });

  it('envoie le fichier en multipart (champ « file ») puis émet la pièce créée', async () => {
    await mount();
    const file = pdf();
    await choose(file);
    const req = http.expectOne(PATH);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush(FILE);
    expect(emitted).toEqual([FILE]);
  });

  it('fichier de plus de 5 Mo ou d’un autre format : refusé sans requête', async () => {
    await mount();
    await choose(pdf(5 * 1024 * 1024 + 1));
    expect(text()).toContain('Fichier trop volumineux (5 Mo max).');
    await choose(new File(['MZ'], 'photo.png', { type: 'application/x-msdownload' }));
    expect(text()).toContain('Format non accepté');
    http.expectNone(PATH);
  });

  it.each([
    [415, 'Format non accepté : JPEG, PNG, WebP ou PDF.'],
    [413, 'Fichier trop volumineux (5 Mo max).'],
    [422, 'Espace de stockage plein'],
    [409, 'déjà une pièce jointe'],
  ])('erreur %i du serveur ⇒ message clair', async (code, message) => {
    await mount();
    await choose(pdf());
    http.expectOne(PATH).flush(null, status(code));
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(message);
    expect(emitted).toEqual([]);
  });

  it('avec pièce : nom et taille, « Ouvrir » dirige un nouvel onglet vers l’URL signée', async () => {
    await mount(FILE);
    expect(text()).toContain('Justificatif : facture.pdf (2 Ko)');
    const tab = { opener: window as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

    button('Ouvrir').click();
    expect(open).toHaveBeenCalledWith('', '_blank'); // pendant le clic : pas bloqué comme popup
    expect(tab.opener).toBeNull();
    const req = http.expectOne(PATH);
    expect(req.request.method).toBe('GET');
    req.flush({ url: 'https://s3.example/signed?X-Amz-Expires=300' });
    expect(tab.location.href).toBe('https://s3.example/signed?X-Amz-Expires=300');
    open.mockRestore();
  });

  it('« Retirer » supprime la pièce et émet null', async () => {
    await mount(FILE);
    button('Retirer').click();
    const req = http.expectOne(PATH);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(emitted).toEqual([null]);
  });
});

describe('Pièce jointe dans l’historique', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const restored = TestBed.inject(Session).restore();
    http.expectOne('/api/v1/me').flush({ id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null });
    await restored;
  });
  afterEach(() => http.verify());

  it('une pièce jointe envoyée apparaît sur la ligne de la transaction', async () => {
    const harness = await RouterTestingHarness.create('/history');
    for (const url of ['/api/v1/accounts', '/api/v1/categories', '/api/v1/tags']) http.expectOne(url).flush([]);
    http.expectOne((r) => r.url === '/api/v1/transactions').flush({ items: [tx()], nextCursor: null });
    await harness.fixture.whenStable();
    el = harness.routeNativeElement!;
    fixture = harness.fixture as unknown as ComponentFixture<AttachmentControl>;

    await choose(pdf());
    http.expectOne(PATH).flush(FILE);
    await harness.fixture.whenStable();

    expect(el.querySelector('li.row')!.textContent).toContain('Justificatif : facture.pdf');
    expect(el.querySelector('input[type=file]')).toBeNull();
  });
});
