import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormRecord, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES, AttachmentUrlDto, DocumentDto, StorageUsageDto, TagDto } from '@budgetracker/shared';
import { forkJoin, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';
import { formatBytes } from './my-account-page';

type Sort = 'recent' | 'old' | 'name' | 'size' | 'type';
export interface DocumentFilters {
  q: string;
  /** '' = tous, 'image' = toutes les images, sinon un type MIME. */
  type: string;
  tagId: string;
  sort: Sort;
}
type Dialog = 'preview' | 'tags' | 'manage' | 'delete';

// Ajout (instant UTC) dans le fuseau du navigateur ; jour de transaction ('YYYY-MM-DD') lu en UTC pour ne pas changer de jour.
const ADDED = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const COLLATOR = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const TYPE_LABELS: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF' };
export const typeLabel = (mime: string): string => TYPE_LABELS[mime] ?? mime;
const isImage = (mime: string) => mime.startsWith('image/');

const SORTS: Record<Sort, (a: DocumentDto, b: DocumentDto) => number> = {
  recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
  old: (a, b) => a.createdAt.localeCompare(b.createdAt),
  name: (a, b) => COLLATOR.compare(a.originalName, b.originalName),
  size: (a, b) => b.sizeBytes - a.sizeBytes,
  type: (a, b) => typeLabel(a.mime).localeCompare(typeLabel(b.mime)) || b.createdAt.localeCompare(a.createdAt),
};

/** Documents filtrés (nom, type, tag) puis triés ; fonction pure, testée à part. */
export function filterDocuments(docs: DocumentDto[], { q, type, tagId, sort }: DocumentFilters): DocumentDto[] {
  const needle = q.trim().toLocaleLowerCase('fr');
  return docs
    .filter((d) => (!needle || d.originalName.toLocaleLowerCase('fr').includes(needle)) && (!type || (type === 'image' ? isImage(d.mime) : d.mime === type)) && (!tagId || d.tagIds.includes(tagId)))
    .sort(SORTS[sort]);
}

// Coffre-fort (SPEC §4) : tous les documents de l'utilisateur, joints à une transaction ou déposés ici.
// Liste complète chargée une fois ; tri, filtres et recherche côté client.
@Component({
  selector: 'app-vault-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="crumb"><a routerLink="/me">Mon compte</a></p>
    <h1>Coffre-fort</h1>

    <section class="card summary" aria-label="Espace et dépôt">
      <div class="usage">
        @if (storage(); as s) {
          <p>{{ size(s.usedBytes) }} utilisés sur {{ size(s.quotaBytes) }} ({{ storagePct() }} %)</p>
          <span class="gauge" aria-hidden="true"><span class="gauge-fill" [style.width.%]="storagePct()"></span></span>
          <p class="muted hint">Les justificatifs des transactions mises à la corbeille comptent jusqu'à leur purge (30 jours).</p>
        } @else if (storageError()) {
          <p class="muted">Espace utilisé indisponible pour le moment.</p>
        } @else {
          <p class="muted" role="status">Chargement de l'espace utilisé…</p>
        }
      </div>
      <div class="deposit">
        <label for="vault-file">Déposer un document (JPEG, PNG, WebP ou PDF, 5 Mo max)</label>
        <input type="file" id="vault-file" [accept]="accept" [disabled]="uploading()" (change)="upload($event)" aria-describedby="vault-file-error" />
        @if (uploading()) {
          <p class="muted" role="status">Envoi en cours…</p>
        }
        @if (uploadError(); as e) {
          <p id="vault-file-error" class="field-error" role="alert">{{ e }}</p>
        }
      </div>
    </section>

    @if (error(); as e) {
      @if (!dialog()) {
        <p class="alert alert-error" role="alert">
          {{ e }}
          <button type="button" class="link-button" (click)="load()">Recharger</button>
        </p>
      }
    }
    @if (notice(); as n) {
      <p class="alert alert-success confirm-pop" role="status">{{ n }}</p>
    }

    <form class="filters" [formGroup]="filters" aria-label="Filtres des documents">
      <div class="field search">
        <label for="v-q">Rechercher par nom</label>
        <input id="v-q" type="search" formControlName="q" autocomplete="off" />
      </div>
      <div class="field">
        <label for="v-type">Type</label>
        <select id="v-type" formControlName="type">
          <option value="">Tous</option>
          <option value="image">Images</option>
          <option value="application/pdf">PDF</option>
        </select>
      </div>
      <div class="field">
        <label for="v-tag">Tag</label>
        <select id="v-tag" formControlName="tagId">
          <option value="">Tous</option>
          @for (t of tags(); track t.id) {
            <option [value]="t.id">{{ t.name }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="v-sort">Trier par</label>
        <select id="v-sort" formControlName="sort">
          <option value="recent">Ajout, plus récents</option>
          <option value="old">Ajout, plus anciens</option>
          <option value="name">Nom</option>
          <option value="size">Taille, plus gros</option>
          <option value="type">Type</option>
        </select>
      </div>
    </form>

    <div class="list-head">
      <p class="muted" aria-live="polite">
        @if (!loading() && !error()) {
          {{ visible().length }} document{{ visible().length > 1 ? 's' : '' }}
          @if (filtered()) {
            sur {{ docs().length }}
          }
        }
      </p>
      <button type="button" class="button button-secondary" (click)="openManage()">Gérer les tags</button>
    </div>

    @if (loading()) {
      <p class="muted" role="status">Chargement des documents…</p>
    } @else if (docs().length || !error()) {
      <ul class="rows" aria-label="Documents">
        @for (d of visible(); track d.id) {
          <li class="row">
            <div class="row-main">
              <strong class="name">{{ d.originalName }}</strong>
              <span class="muted">{{ type(d.mime) }} · {{ size(d.sizeBytes) }} · ajouté le {{ added(d.createdAt) }}</span>
              <span class="muted">
                @if (d.transaction; as t) {
                  Transaction :
                  <a routerLink="/history" [queryParams]="{ from: t.date, to: t.date, accountId: t.accountId }">{{ t.name || 'sans libellé' }} du {{ day(t.date) }}</a>
                } @else {
                  Déposé dans le coffre
                }
              </span>
              @if (d.tagIds.length) {
                <ul class="tag-list" aria-label="Tags">
                  @for (id of d.tagIds; track id) {
                    <li class="badge badge-neutral">{{ tagNames()[id] }}</li>
                  }
                </ul>
              }
            </div>
            <div class="actions">
              <button type="button" class="button button-secondary" [disabled]="busy() === d.id" (click)="preview(d)">
                Aperçu<span class="visually-hidden"> de {{ d.originalName }}</span>
              </button>
              <button type="button" class="button button-secondary" [disabled]="busy() === d.id" (click)="download(d)">
                Télécharger<span class="visually-hidden"> {{ d.originalName }}</span>
              </button>
              <button type="button" class="button button-secondary" [disabled]="busy() === d.id" (click)="openTags(d)">
                Tags<span class="visually-hidden"> de {{ d.originalName }}</span>
              </button>
              <button type="button" class="button button-secondary" [disabled]="busy() === d.id" (click)="openDelete(d)">
                Supprimer<span class="visually-hidden"> {{ d.originalName }}</span>
              </button>
            </div>
          </li>
        } @empty {
          @if (filtered()) {
            <li class="empty muted">
              Aucun document ne correspond aux filtres.
              <button type="button" class="link-button" (click)="clearFilters()">Effacer les filtres</button>
            </li>
          } @else if (!error()) {
            <li class="empty muted">Aucun document. Déposez-en un ci-dessus ou joignez un justificatif à une transaction depuis l'<a routerLink="/history">historique</a>.</li>
          }
        }
      </ul>
    }

    <dialog #previewDialog class="modal preview" aria-labelledby="preview-title" (close)="closed()">
      <h2 id="preview-title" class="name">{{ current()?.originalName }}</h2>
      @if (previewUrl(); as url) {
        <img [src]="url" [alt]="'Aperçu de ' + current()?.originalName" />
      }
      <div class="actions">
        <button type="button" class="button button-secondary" (click)="previewDialog.close()">Fermer</button>
      </div>
    </dialog>

    <dialog #tagsDialog class="modal" aria-labelledby="tags-title" (close)="closed()">
      <h2 id="tags-title">Tags de <span class="name">{{ current()?.originalName }}</span></h2>
      @if (error() && dialog() === 'tags') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <form class="form" [formGroup]="tagChoice" (ngSubmit)="saveTags()">
        <fieldset class="field">
          <legend>Tags du document</legend>
          <!-- Contrôles créés à l'ouverture (la modale reste dans le DOM). -->
          @for (t of tags(); track t.id) {
            @if (tagChoice.contains(t.id)) {
              <label class="checkbox"><input type="checkbox" [formControlName]="t.id" /> {{ t.name }}</label>
            }
          } @empty {
            <p class="muted">Aucun tag pour l'instant : créez-en un ci-dessous.</p>
          }
        </fieldset>
        <div class="field">
          <label for="new-tag">Nouveau tag</label>
          <div class="inline">
            <input id="new-tag" [formControl]="newTag" maxlength="50" autocomplete="off" />
            <button type="button" class="button button-secondary" [disabled]="newTag.invalid || saving()" (click)="createTag()">Créer le tag</button>
          </div>
        </div>
        @if (saving()) {
          <p class="muted" role="status">Enregistrement…</p>
        }
        <div class="actions">
          <button type="submit" class="button" [disabled]="saving()">Enregistrer les tags</button>
          <button type="button" class="button button-secondary" (click)="tagsDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>

    <dialog #manageDialog class="modal" aria-labelledby="manage-title" (close)="closed()">
      <h2 id="manage-title">Gérer les tags</h2>
      <p class="muted">Les tags sont communs aux documents et aux transactions : renommer ou supprimer un tag le change partout.</p>
      @if (error() && dialog() === 'manage') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <form [formGroup]="renames">
        <ul class="manage-list">
          @for (t of tags(); track t.id) {
            @if (renames.contains(t.id)) {
            <li>
              <label class="visually-hidden" [for]="'rename-' + t.id">Nom du tag {{ t.name }}</label>
              <input [id]="'rename-' + t.id" [formControlName]="t.id" maxlength="50" autocomplete="off" />
              @if (confirmingDelete() === t.id) {
                <button type="button" class="button button-danger" [disabled]="saving()" (click)="deleteTag(t)">Confirmer la suppression<span class="visually-hidden"> de {{ t.name }}</span></button>
                <button type="button" class="button button-secondary" (click)="confirmingDelete.set(null)">Garder</button>
              } @else {
                <button type="button" class="button button-secondary" [disabled]="saving() || !canRename(t)" (click)="renameTag(t)">
                  Renommer<span class="visually-hidden"> {{ t.name }}</span>
                </button>
                <button type="button" class="button button-secondary" [disabled]="saving()" (click)="confirmingDelete.set(t.id)">Supprimer<span class="visually-hidden"> le tag {{ t.name }}</span></button>
              }
            </li>
            }
          } @empty {
            <li class="muted">Aucun tag.</li>
          }
        </ul>
      </form>
      @if (saving()) {
        <p class="muted" role="status">Enregistrement…</p>
      }
      <div class="actions">
        <button type="button" class="button button-secondary" (click)="manageDialog.close()">Fermer</button>
      </div>
    </dialog>

    <dialog #deleteDialog class="modal" aria-labelledby="delete-title" (close)="closed()">
      <h2 id="delete-title" class="danger-title">Supprimer le document</h2>
      @if (error() && dialog() === 'delete') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <p>
        <strong class="name">{{ current()?.originalName }}</strong> sera effacé définitivement.
        @if (current()?.transaction) {
          La transaction liée reste, sans ce justificatif.
        }
      </p>
      @if (saving()) {
        <p class="muted" role="status">Suppression en cours…</p>
      }
      <div class="actions">
        <button type="button" class="button button-danger" [disabled]="saving()" (click)="remove()">Supprimer définitivement le document</button>
        <button type="button" class="button button-secondary" (click)="deleteDialog.close()">Annuler</button>
      </div>
    </dialog>
  `,
  styles: `
    .crumb {
      margin: 0 0 var(--space-1);
      font-size: var(--text-sm);
    }
    .summary {
      display: grid;
      gap: var(--space-4);
      p {
        margin: 0;
      }
    }
    .usage {
      display: grid;
      gap: var(--space-2);
    }
    .hint,
    .deposit label {
      font-size: var(--text-sm);
    }
    .deposit {
      display: grid;
      gap: var(--space-2);
      input[type='file'] {
        max-width: 100%;
        min-height: var(--tap);
        font: inherit;
      }
      .field-error {
        margin: 0;
      }
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
      margin: var(--space-4) 0;
      .search {
        grid-column: 1 / -1;
      }
      select,
      input {
        width: 100%;
      }
    }
    .list-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
      p {
        margin: 0;
      }
    }
    // Une surface pour la liste, lignes séparées par un filet (comme l'historique).
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
    }
    .row {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
    }
    .row-main {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
      .muted {
        font-size: var(--text-sm);
      }
    }
    // Nom d'origine : texte brut (interpolation), coupé n'importe où pour les noms sans espace.
    .name {
      overflow-wrap: anywhere;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .actions {
      flex-wrap: wrap;
    }
    .empty {
      padding: var(--space-4);
      text-align: center;
    }
    .preview img {
      display: block;
      max-width: 100%;
      max-height: 70vh;
      margin: 0 auto var(--space-3);
      object-fit: contain;
    }
    .inline {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      input {
        flex: 1 1 10rem;
      }
    }
    .manage-list {
      display: grid;
      gap: var(--space-2);
      list-style: none;
      margin: 0 0 var(--space-3);
      padding: 0;
      li {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      input {
        flex: 1 1 10rem;
      }
    }
    @media (min-width: 768px) {
      .filters {
        grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(0, 1fr));
        .search {
          grid-column: auto;
        }
      }
      .summary {
        grid-template-columns: 1fr 1fr;
        align-items: start;
      }
      .row {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }
    }
  `,
})
export class VaultPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly accept = ATTACHMENT_MIME_TYPES.join(',');
  protected readonly docs = signal<DocumentDto[]>([]);
  protected readonly tags = signal<TagDto[]>([]);
  protected readonly tagNames = computed(() => Object.fromEntries(this.tags().map((t) => [t.id, t.name])));
  protected readonly storage = signal<StorageUsageDto | null>(null);
  protected readonly storageError = signal(false);
  protected readonly storagePct = computed(() => {
    const s = this.storage();
    return s && s.quotaBytes ? Math.min(100, Math.round((s.usedBytes / s.quotaBytes) * 100)) : 0;
  });

  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** Document dont une action (aperçu, téléchargement) est en cours. */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly filters = this.fb.group<DocumentFilters>({ q: '', type: '', tagId: '', sort: 'recent' });
  private readonly filterValue = toSignal(this.filters.valueChanges.pipe(map(() => this.filters.getRawValue())), { initialValue: this.filters.getRawValue() });
  protected readonly visible = computed(() => filterDocuments(this.docs(), this.filterValue()));
  protected readonly filtered = computed(() => {
    const { q, type, tagId } = this.filterValue();
    return !!(q.trim() || type || tagId);
  });

  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly current = signal<DocumentDto | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly tagChoice = new FormRecord<FormControl<boolean>>({});
  protected readonly renames = new FormRecord<FormControl<string>>({});
  protected readonly newTag = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(50), Validators.pattern(/\S/)] });

  private readonly previewDialog = viewChild.required<ElementRef<HTMLDialogElement>>('previewDialog');
  private readonly tagsDialog = viewChild.required<ElementRef<HTMLDialogElement>>('tagsDialog');
  private readonly manageDialog = viewChild.required<ElementRef<HTMLDialogElement>>('manageDialog');
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');
  private readonly dialogs = { preview: this.previewDialog, tags: this.tagsDialog, manage: this.manageDialog, delete: this.deleteDialog };

  constructor() {
    this.load();
  }

  protected readonly size = formatBytes;
  protected readonly type = typeLabel;
  protected added(iso: string): string {
    return ADDED.format(new Date(iso));
  }
  protected day(date: string): string {
    return DAY.format(new Date(`${date}T00:00:00Z`));
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin([this.api.get<DocumentDto[]>('/documents'), this.api.get<TagDto[]>('/tags')]).subscribe({
      next: ([docs, tags]) => {
        this.docs.set(docs);
        this.tags.set(tags);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(errorMessage(e, {}));
      },
    });
    this.loadStorage();
  }

  private loadStorage(): void {
    this.api.get<StorageUsageDto>('/me/storage').subscribe({
      next: (s) => {
        this.storageError.set(false);
        this.storage.set(s);
      },
      error: () => this.storageError.set(true),
    });
  }

  protected clearFilters(): void {
    this.filters.patchValue({ q: '', type: '', tagId: '' });
  }

  protected upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.uploadError.set(null);
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) return this.uploadError.set('Fichier trop volumineux (5 Mo max).');
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) return this.uploadError.set('Format non accepté : JPEG, PNG, WebP ou PDF.');
    const body = new FormData();
    body.append('file', file);
    this.uploading.set(true);
    this.notice.set(null);
    this.api.post('/documents', body).subscribe({
      next: () => {
        this.uploading.set(false);
        this.notice.set('Document ajouté au coffre.');
        this.load();
      },
      error: (e) => {
        this.uploading.set(false);
        this.uploadError.set(
          errorMessage(e, {
            413: 'Fichier trop volumineux (5 Mo max).',
            415: 'Format non accepté : JPEG, PNG, WebP ou PDF.',
            422: 'Espace de stockage plein : supprimez d’anciens documents.',
          }),
        );
      },
    });
  }

  private url(d: DocumentDto, download: boolean): Observable<AttachmentUrlDto> {
    return this.api.get<AttachmentUrlDto>(`/documents/${d.id}/url`, download ? { download: 1 } : undefined);
  }

  /** Image : modale. PDF : visionneuse du navigateur dans un onglet ouvert pendant le clic (sinon bloqué comme popup). */
  protected preview(d: DocumentDto): void {
    const tab = isImage(d.mime) ? null : window.open('', '_blank');
    if (tab) tab.opener = null;
    this.run(d, this.url(d, false), ({ url }) => {
      if (isImage(d.mime)) {
        this.previewUrl.set(url);
        this.show('preview', d);
      } else if (tab) tab.location.href = url;
      else window.location.assign(url);
    }, () => tab?.close());
  }

  /** URL signée en Content-Disposition attachment : la navigation télécharge sans quitter la page. */
  protected download(d: DocumentDto): void {
    this.run(d, this.url(d, true), ({ url }) => Object.assign(document.createElement('a'), { href: url }).click());
  }

  private run<T>(d: DocumentDto, request: Observable<T>, next: (value: T) => void, onError?: () => void): void {
    this.busy.set(d.id);
    this.error.set(null);
    request.subscribe({
      next: (v) => {
        this.busy.set(null);
        next(v);
      },
      error: (e) => {
        this.busy.set(null);
        onError?.();
        this.error.set(errorMessage(e, { 404: 'Ce document n’existe plus. Rechargez la liste.' }));
      },
    });
  }

  private show(dialog: Dialog, d: DocumentDto | null): void {
    this.error.set(null);
    this.notice.set(null);
    this.current.set(d);
    this.dialog.set(dialog);
    this.dialogs[dialog]().nativeElement.showModal();
  }

  /** Erreur affichée dans la modale : effacée avec elle. */
  protected closed(): void {
    if (this.dialog() !== 'preview') this.error.set(null);
    this.dialog.set(null);
    this.previewUrl.set(null);
    this.confirmingDelete.set(null);
    this.newTag.reset();
  }

  protected openTags(d: DocumentDto): void {
    this.resetChoice(d.tagIds);
    this.show('tags', d);
  }

  private resetChoice(checked: string[]): void {
    for (const id of Object.keys(this.tagChoice.controls)) this.tagChoice.removeControl(id);
    for (const t of this.tags()) this.tagChoice.addControl(t.id, new FormControl(checked.includes(t.id), { nonNullable: true }));
  }

  protected createTag(): void {
    if (this.newTag.invalid) return;
    const checked = Object.entries(this.tagChoice.getRawValue()).filter(([, v]) => v).map(([id]) => id);
    this.save(this.api.post<TagDto>('/tags', { name: this.newTag.value.trim() }), (tag) => {
      this.tags.update((all) => [...all, tag].sort((a, b) => COLLATOR.compare(a.name, b.name)));
      this.resetChoice([...checked, tag.id]);
      this.newTag.reset();
    });
  }

  protected saveTags(): void {
    const d = this.current();
    if (!d) return;
    const tagIds = Object.entries(this.tagChoice.getRawValue()).filter(([, v]) => v).map(([id]) => id);
    this.save(this.api.put<DocumentDto>(`/documents/${d.id}/tags`, { tagIds }), (updated) => {
      this.docs.update((all) => all.map((x) => (x.id === updated.id ? updated : x)));
      this.dialogs.tags().nativeElement.close();
      this.notice.set('Tags enregistrés.');
    });
  }

  protected openManage(): void {
    for (const id of Object.keys(this.renames.controls)) this.renames.removeControl(id);
    for (const t of this.tags()) this.renames.addControl(t.id, new FormControl(t.name, { nonNullable: true, validators: [Validators.required, Validators.maxLength(50), Validators.pattern(/\S/)] }));
    this.show('manage', null);
  }

  protected canRename(t: TagDto): boolean {
    const control = this.renames.controls[t.id];
    return !!control && control.valid && control.value.trim() !== t.name;
  }

  protected renameTag(t: TagDto): void {
    const name = this.renames.controls[t.id].value.trim();
    this.save(this.api.patch<TagDto>(`/tags/${t.id}`, { name }), (tag) => {
      this.tags.update((all) => all.map((x) => (x.id === tag.id ? tag : x)).sort((a, b) => COLLATOR.compare(a.name, b.name)));
      this.renames.controls[t.id].setValue(tag.name);
    });
  }

  protected deleteTag(t: TagDto): void {
    this.save(this.api.delete(`/tags/${t.id}`), () => {
      this.confirmingDelete.set(null);
      this.renames.removeControl(t.id);
      this.tags.update((all) => all.filter((x) => x.id !== t.id));
      this.docs.update((all) => all.map((d) => (d.tagIds.includes(t.id) ? { ...d, tagIds: d.tagIds.filter((id) => id !== t.id) } : d)));
      if (this.filters.controls.tagId.value === t.id) this.filters.controls.tagId.setValue('');
    });
  }

  protected openDelete(d: DocumentDto): void {
    this.show('delete', d);
  }

  protected remove(): void {
    const d = this.current();
    if (!d) return;
    this.save(this.api.delete(`/documents/${d.id}`), () => {
      this.docs.update((all) => all.filter((x) => x.id !== d.id));
      this.dialogs.delete().nativeElement.close();
      this.notice.set('Document supprimé.');
      this.loadStorage();
    });
  }

  private save<T>(request: Observable<T>, next: (value: T) => void): void {
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: (v) => {
        this.saving.set(false);
        next(v);
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(errorMessage(e, { 404: 'Ce document ou ce tag n’existe plus. Fermez puis rechargez la liste.', 409: 'Un tag porte déjà ce nom.' }));
      },
    });
  }
}
