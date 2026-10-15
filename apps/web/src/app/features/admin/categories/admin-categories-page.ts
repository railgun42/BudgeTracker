import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminUpdateCategoryInput, CategoryDto, CreateCategoryInput } from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
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
    <h1>Catégories globales</h1>
    <p class="muted">
      Visibles de tous les utilisateurs. <strong>Archiver</strong> retire la catégorie des listes de saisie mais la laisse
      sur les transactions existantes ; elle peut être restaurée. <strong>Supprimer</strong> l'efface définitivement :
      seulement si personne ne l'utilise (ni transaction, ni récurrence, ni sous-catégorie) et si elle a été créée ici,
      les catégories de base étant réinstallées automatiquement.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <ul class="tree" aria-label="Catégories globales">
      @for (root of tree(); track root.category.id) {
        <li>
          <ng-container *ngTemplateOutlet="row; context: { $implicit: root }" />
          @if (root.children.length) {
            <ul class="tree" [attr.aria-label]="'Sous-catégories de ' + root.label">
              @for (child of root.children; track child.category.id) {
                <li><ng-container *ngTemplateOutlet="row; context: { $implicit: child }" /></li>
              }
            </ul>
          }
        </li>
      }
    </ul>

    <ng-template #row let-r>
      <div class="card" [class.archived]="r.category.archived">
        @if (editing() === r.category.id) {
          <form class="inline" [formGroup]="renameForm" (ngSubmit)="rename(r)" novalidate>
            <label [for]="'rename-' + r.category.id">Nouveau nom de « {{ r.label }} »</label>
            <input [id]="'rename-' + r.category.id" formControlName="name" maxlength="100" autocomplete="off" />
            <button class="button" type="submit">Enregistrer</button>
            <button class="button button-secondary" type="button" (click)="editing.set(null)">Annuler</button>
          </form>
        } @else {
          <p>
            <strong>{{ r.label }}</strong>
            @if (r.category.archived) {
              <span class="muted"> (archivée)</span>
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
              <button type="button" class="button button-secondary" (click)="deleting.set(r.category.id)">
                Supprimer<span class="visually-hidden"> {{ r.label }}</span>
              </button>
            }
          </div>
          @if (deleting() === r.category.id) {
            <div class="inline" role="group" [attr.aria-label]="'Supprimer ' + r.label">
              <p>Supprimer définitivement « {{ r.label }} » pour tous les utilisateurs ?</p>
              <button type="button" class="button" (click)="remove(r)">Confirmer la suppression</button>
              <button type="button" class="button button-secondary" (click)="deleting.set(null)">Annuler</button>
            </div>
          }
        }
      </div>
    </ng-template>

    <h2>Nouvelle catégorie globale</h2>
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
      <button class="button" type="submit" [disabled]="pending()">Créer la catégorie</button>
    </form>
  `,
  styles: `
    .tree {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .tree .tree {
      margin-top: var(--space-2);
      padding-left: var(--space-3);
    }
    .card {
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }
    .archived strong {
      text-decoration: line-through;
    }
    .actions,
    .inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
  `,
})
export class AdminCategoriesPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly all = signal<CategoryDto[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal('');

  protected readonly tree = computed(() => {
    const shown = this.all().filter((c) => !isTechnical(c));
    const toRow = (c: CategoryDto): Row => ({ category: c, label: categoryLabel(c), children: [] });
    const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label, 'fr');
    return shown
      .filter((c) => c.parentId === null)
      .map((c) => ({ ...toRow(c), children: shown.filter((k) => k.parentId === c.id).map(toRow).sort(byLabel) }))
      .sort(byLabel);
  });
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

  private reload(): void {
    this.api.get<CategoryDto[]>('/admin/categories').subscribe({
      next: (list) => this.all.set(list),
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
  }

  protected rename(r: Row): void {
    const name = this.renameForm.getRawValue().name.trim();
    this.editing.set(null);
    if (!name || name === r.label) return;
    if (this.taken(name, r.category.parentId, r.category.id)) return void this.error.set(DUPLICATE);
    this.update(r.category, { name });
  }

  protected update(c: CategoryDto, body: AdminUpdateCategoryInput): void {
    this.api.patch<CategoryDto>(`/admin/categories/${c.id}`, body).subscribe({
      next: (updated) => {
        const label = categoryLabel(updated);
        this.done(body.archived === undefined ? `Catégorie renommée en « ${label} ».` : `« ${label} » ${updated.archived ? 'archivée' : 'restaurée'}.`);
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette catégorie n’existe plus.', 409: DUPLICATE, 422: 'Catégorie non modifiable.' })),
    });
  }

  protected remove(r: Row): void {
    this.deleting.set(null);
    this.api.delete(`/admin/categories/${r.category.id}`).subscribe({
      next: () => this.done(`« ${r.label} » supprimée.`),
      error: (e) =>
        this.error.set(
          errorMessage(e, {
            409: `« ${r.label} » est utilisée (transaction, récurrence, sous-catégorie ou suggestion en attente) : archivez-la plutôt.`,
            422: 'Catégorie de base : archivez-la plutôt.',
            404: 'Cette catégorie n’existe plus.',
          }),
        ),
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
    this.api.post<CategoryDto>('/admin/categories', body).subscribe({
      next: () => {
        this.pending.set(false);
        this.form.reset();
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
