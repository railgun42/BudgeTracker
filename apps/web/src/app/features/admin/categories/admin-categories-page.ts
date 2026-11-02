import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminUpdateCategoryInput, CategoryDto, CreateCategoryInput } from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
import { categoryIcon } from '../../../shared-ui/category-icons';
import { categoryLabel, categoryOptions, isTechnical } from '../../../shared-ui/labels';
import { errorMessage } from '../../auth/auth-form';

interface Row {
  category: CategoryDto;
  label: string;
  children: Row[];
}

const DUPLICATE = 'Une catégorie porte déjà ce nom à cet endroit.';
const sameName = (a: string, b: string) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');

// E38 (SPEC §13.3) : catégories globales, visibles de tous. Créer, renommer, archiver (utilisée) ou supprimer
// (inutilisée et créée ici ; le serveur tranche). Les techniques (intérêts, virement…) n'y figurent pas. Route réservée aux admins.
@Component({
  selector: 'app-admin-categories-page',
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p><a routerLink="/admin">← Administration</a></p>
    <div class="page-head">
      <h1>Catégories globales</h1>
      <button type="button" class="button" (click)="error.set(null); createDialog.showModal()">Nouvelle catégorie globale</button>
    </div>
    <p class="muted intro">
      Visibles de tous les utilisateurs. <strong>Archiver</strong> retire la catégorie des listes de saisie mais la laisse
      sur les transactions existantes ; elle peut être restaurée. <strong>Supprimer</strong> l'efface définitivement :
      seulement si personne ne l'utilise (ni transaction, ni récurrence, ni sous-catégorie) et si elle a été créée ici,
      les catégories de base étant réinstallées automatiquement.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        <button type="button" class="link-button" (click)="error.set(null); reload()">Recharger</button>
      </p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    @if (loaded()) {
      <!-- Une surface par catégorie racine, ses sous-catégories en lignes séparées par un filet (comme Mes catégories). -->
      <ul class="groups" aria-label="Catégories globales">
        @for (root of tree(); track root.category.id) {
          <li class="group">
            <ng-container *ngTemplateOutlet="row; context: { $implicit: root, root: true }" />
            @if (root.children.length) {
              <ul class="sub" [attr.aria-label]="'Sous-catégories de ' + root.label">
                @for (child of root.children; track child.category.id) {
                  <li><ng-container *ngTemplateOutlet="row; context: { $implicit: child, root: false }" /></li>
                }
              </ul>
            }
          </li>
        } @empty {
          <li class="empty muted">Aucune catégorie globale. Créez-en une avec « Nouvelle catégorie globale ».</li>
        }
      </ul>
    } @else if (!error()) {
      <p class="muted" role="status">Chargement…</p>
    }

    <ng-template #row let-r let-isRoot="root">
      <div class="row" [class.archived]="r.category.archived" [class.confirm-pop]="touched() === r.category.id">
        @if (editing() === r.category.id) {
          <form class="inline" [formGroup]="renameForm" (ngSubmit)="rename(r)" (keydown.escape)="editing.set(null)" novalidate>
            <div class="field">
              <label [for]="'rename-' + r.category.id">Nouveau nom de « {{ r.label }} »</label>
              <input [id]="'rename-' + r.category.id" formControlName="name" maxlength="100" autocomplete="off" />
            </div>
            <div class="actions">
              <button class="button" type="submit">Enregistrer</button>
              <button class="button button-secondary" type="button" (click)="editing.set(null)">Annuler</button>
            </div>
          </form>
        } @else {
          <p class="row-main">
            @if (isRoot) {
              <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icon(r.category)" /></svg>
            }
            <strong>{{ r.label }}</strong>
            @if (r.category.archived) {
              <span class="visually-hidden">, </span><span class="badge badge-neutral">archivée</span>
            }
          </p>
          <div class="actions">
            <button type="button" class="button button-secondary" (click)="startRename(r)">
              Renommer<span class="visually-hidden"> {{ r.label }}</span>
            </button>
            <button type="button" class="button button-secondary" (click)="update(r.category, { archived: !r.category.archived })">
              {{ r.category.archived ? 'Restaurer' : 'Archiver' }}<span class="visually-hidden"> {{ r.label }}</span>
            </button>
            @if (!r.category.nameKey) {
              <button type="button" class="button button-secondary" (click)="startDelete(r)">
                Supprimer<span class="visually-hidden"> {{ r.label }}</span>
              </button>
            }
          </div>
        }
      </div>
    </ng-template>

    <!-- Modales natives (Échap, focus piégé, voile) ; la page derrière est inerte, d'où l'erreur répétée dedans. -->
    <dialog #createDialog class="modal" aria-labelledby="global-dialog-title" (close)="form.reset()">
      <h2 id="global-dialog-title">Nouvelle catégorie globale</h2>
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <form class="form" [formGroup]="form" (ngSubmit)="create()" novalidate>
        <div class="field">
          <label for="global-name">Nom</label>
          <input id="global-name" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="nameInvalid()" aria-describedby="global-name-hint" />
          <p id="global-name-hint" [class]="nameInvalid() ? 'field-error' : 'field-hint'">Obligatoire, 100 caractères au plus.</p>
        </div>
        <div class="field">
          <label for="global-parent">Dans la catégorie (facultatif)</label>
          <select id="global-parent" formControlName="parentId">
            <option value="">Aucune : catégorie principale</option>
            @for (c of parents(); track c.id) {
              <option [value]="c.id">{{ c.label }}</option>
            }
          </select>
        </div>
        <div class="actions">
          <button class="button" type="submit" [disabled]="pending()">Créer la catégorie</button>
          <button class="button button-secondary" type="button" (click)="createDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>

    <!-- Seule une catégorie inutilisée se supprime (sinon 409) : pas de mot à saisir, mais bouton danger. -->
    <dialog #deleteDialog class="modal" aria-labelledby="global-del-title" (close)="deleting.set(null)">
      @if (deletingRow(); as r) {
        <h2 id="global-del-title" class="danger-title">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3zM12 10v5M12 18v.01" /></svg>
          Supprimer « {{ r.label }} »
        </h2>
        @if (error()) {
          <p class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <p>Supprimer définitivement « {{ r.label }} » pour tous les utilisateurs ?</p>
        @if (pending()) {
          <p class="muted" role="status">Suppression en cours…</p>
        }
        <div class="actions">
          <button type="button" class="button button-danger" [disabled]="pending()" (click)="remove(r)">Confirmer la suppression</button>
          <button type="button" class="button button-secondary" (click)="deleteDialog.close()">Annuler</button>
        </div>
      }
    </dialog>
  `,
  // Mise en page seulement : boutons, champs, bandeaux, modales, pastilles et icônes viennent de la charte (styles.scss).
  styles: `
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-2);
      h1 {
        margin: 0;
      }
    }
    .intro {
      max-width: 40rem;
      margin: 0 0 var(--space-4);
    }
    .groups,
    .sub {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .groups {
      display: grid;
      gap: var(--space-3);
    }
    .group {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
    }
    .sub > li {
      border-top: 1px solid var(--color-border);
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      align-items: center;
      padding: var(--space-3);
      > form {
        grid-column: 1 / -1;
      }
    }
    // Sous-catégorie : nom aligné sur celui de la racine (après l'icône).
    .sub .row {
      padding-left: calc(var(--space-3) + var(--space-5) + var(--space-2));
    }
    .row-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    // Archivée : nom barré et atténué, doublé de la pastille écrite « archivée ».
    .archived strong {
      color: var(--color-text-muted);
      text-decoration: line-through;
    }
    .inline {
      display: grid;
      gap: var(--space-2);
    }
    .empty {
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    @media (min-width: 768px) {
      .row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .inline {
        grid-template-columns: minmax(0, 24rem) auto;
        align-items: end;
      }
    }
  `,
})
export class AdminCategoriesPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly injector = inject(Injector);
  private readonly createDialog = viewChild.required<ElementRef<HTMLDialogElement>>('createDialog');
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');

  private readonly all = signal<CategoryDto[]>([]);
  protected readonly loaded = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  /** Dernière catégorie créée ou modifiée : sa ligne rejoue confirm-pop. */
  protected readonly touched = signal<string | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal('');
  protected readonly icon = categoryIcon;

  protected readonly tree = computed(() => {
    const shown = this.all().filter((c) => !isTechnical(c));
    const toRow = (c: CategoryDto): Row => ({ category: c, label: categoryLabel(c), children: [] });
    const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label, 'fr');
    return shown
      .filter((c) => c.parentId === null)
      .map((c) => ({ ...toRow(c), children: shown.filter((k) => k.parentId === c.id).map(toRow).sort(byLabel) }))
      .sort(byLabel);
  });
  protected readonly deletingRow = computed(() =>
    this.tree()
      .flatMap((r) => [r, ...r.children])
      .find((r) => r.category.id === this.deleting()),
  );
  /** Parents possibles : racines ni techniques ni archivées (2 niveaux max). */
  protected readonly parents = computed(() => categoryOptions(this.all(), null));

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
    parentId: [''],
  });
  protected readonly renameForm = this.fb.group({ name: [''] });

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.api.get<CategoryDto[]>('/admin/categories').subscribe({
      next: (list) => {
        this.all.set(list);
        this.loaded.set(true);
      },
      error: (e) => this.error.set(errorMessage(e, { 403: 'Accès réservé aux administrateurs.' })),
    });
  }

  private done(message: string): void {
    this.error.set(null);
    this.status.set(message);
    this.reload();
  }

  // Le serveur refuse un doublon sur les noms libres ; les libellés traduits du seed ne sont connus qu'ici.
  private taken(name: string, parentId: string | null, except?: string): boolean {
    return this.all().some((c) => c.parentId === parentId && c.id !== except && sameName(categoryLabel(c), name));
  }

  protected nameInvalid(): boolean {
    const c = this.form.controls.name;
    return c.invalid && c.touched;
  }

  protected startRename(r: Row): void {
    this.renameForm.setValue({ name: r.label });
    this.editing.set(r.category.id);
    afterNextRender(() => document.getElementById(`rename-${r.category.id}`)?.focus(), { injector: this.injector });
  }

  protected startDelete(r: Row): void {
    this.error.set(null);
    this.deleting.set(r.category.id);
    this.deleteDialog().nativeElement.showModal();
  }

  protected rename(r: Row): void {
    const name = this.renameForm.getRawValue().name.trim();
    this.editing.set(null);
    if (!name || name === r.label) return;
    if (this.taken(name, r.category.parentId, r.category.id)) return void this.error.set(DUPLICATE);
    this.update(r.category, { name });
  }

  protected update(c: CategoryDto, body: AdminUpdateCategoryInput): void {
    this.touched.set(null);
    this.api.patch<CategoryDto>(`/admin/categories/${c.id}`, body).subscribe({
      next: (updated) => {
        const label = categoryLabel(updated);
        this.touched.set(updated.id);
        this.done(body.archived === undefined ? `Catégorie renommée en « ${label} ».` : `« ${label} » ${updated.archived ? 'archivée' : 'restaurée'}.`);
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette catégorie n’existe plus.', 409: DUPLICATE, 422: 'Catégorie non modifiable.' })),
    });
  }

  protected remove(r: Row): void {
    this.pending.set(true);
    this.api.delete(`/admin/categories/${r.category.id}`).subscribe({
      next: () => {
        this.pending.set(false);
        this.deleteDialog().nativeElement.close();
        this.done(`« ${r.label} » supprimée.`);
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            409: `« ${r.label} » est utilisée (transaction, récurrence, sous-catégorie ou suggestion en attente) : archivez-la plutôt.`,
            422: 'Catégorie de base : archivez-la plutôt.',
            404: 'Cette catégorie n’existe plus.',
          }),
        );
      },
    });
  }

  protected create(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, parentId } = this.form.getRawValue();
    const body: CreateCategoryInput = { name: name.trim(), ...(parentId ? { parentId } : {}) };
    if (this.taken(body.name, parentId || null)) return void this.error.set(DUPLICATE);
    this.pending.set(true);
    this.touched.set(null);
    this.api.post<CategoryDto>('/admin/categories', body).subscribe({
      next: (created) => {
        this.pending.set(false);
        this.touched.set(created.id);
        this.createDialog().nativeElement.close();
        this.done(`Catégorie « ${body.name} » créée pour tous les utilisateurs.`);
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, { 404: 'La catégorie parente n’existe plus.', 409: DUPLICATE, 422: 'Parent impossible : deux niveaux au maximum, ni archivé ni technique.' }),
        );
      },
    });
  }
}
