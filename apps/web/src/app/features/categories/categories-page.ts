import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CategoryDto, CategoryPreferenceInput, CategorySuggestionDto, CategorySuggestionStatus, CreateCategoryInput } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { CATEGORY_LABELS, categoryLabel, categoryOptions, isTechnical } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

export const SUGGESTION_STATUS_LABELS: Record<CategorySuggestionStatus, string> = {
  PENDING: 'En attente',
  ACCEPTED: 'Acceptée',
  REJECTED: 'Refusée',
  TREATED: 'Traitée',
};

interface Row {
  category: CategoryDto;
  label: string;
  children: Row[];
}

// E36 (SPEC §13.4) : catégories globales (masquer / renommer pour soi seul) et personnelles
// (créer, y compris sous une globale, renommer, supprimer avec réaffectation). Les techniques n'y figurent pas.
// E41 (SPEC §13.5) : à la création, case facultative « proposer cette catégorie à tous » et suivi de ses suggestions.
@Component({
  selector: 'app-categories-page',
  imports: [ReactiveFormsModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mes catégories</h1>
    <p class="muted">
      Masquer ou renommer une catégorie globale ne concerne que vous : elle reste sur vos transactions existantes,
      seule la liste de saisie l'exclut.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <ul class="tree" aria-label="Catégories">
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
      <div class="card" [class.hidden-category]="r.category.hidden">
        @if (editing() === r.category.id) {
          <form class="inline" [formGroup]="renameForm" (ngSubmit)="saveName(r.category)" novalidate>
            <label [for]="'rename-' + r.category.id">Nouveau nom de « {{ r.label }} »</label>
            <input [id]="'rename-' + r.category.id" formControlName="name" maxlength="100" autocomplete="off" />
            <button class="button" type="submit">Enregistrer</button>
            <button class="button button-secondary" type="button" (click)="editing.set(null)">Annuler</button>
          </form>
        } @else {
          <p>
            <strong>{{ r.label }}</strong>
            <span class="muted">
              ({{ r.category.system ? 'globale' : 'personnelle' }}@if (r.category.customName) {, d'origine « {{ originalLabel(r.category) }} »}@if (r.category.hidden) {, masquée}@if (r.category.archived) {, archivée})
            </span>
          </p>
          <div class="actions">
            <button type="button" class="button button-secondary" (click)="startRename(r.category)">
              Renommer<span class="visually-hidden"> {{ r.label }}</span>
            </button>
            @if (r.category.system) {
              <button type="button" class="button button-secondary" (click)="setPreference(r.category, { hidden: !r.category.hidden })">
                {{ r.category.hidden ? 'Afficher' : 'Masquer' }}<span class="visually-hidden"> {{ r.label }}</span>
              </button>
              @if (r.category.customName) {
                <button type="button" class="button button-secondary" (click)="setPreference(r.category, { customName: null })">
                  Nom d'origine<span class="visually-hidden"> pour {{ r.label }}</span>
                </button>
              }
            } @else {
              <button type="button" class="button button-secondary" (click)="startDelete(r.category)">
                Supprimer<span class="visually-hidden"> {{ r.label }}</span>
              </button>
            }
          </div>
        }
        @if (deleting()?.id === r.category.id) {
          <form class="inline" [formGroup]="deleteForm" (ngSubmit)="confirmDelete(r.category)" novalidate>
            <label [for]="'reassign-' + r.category.id">Transactions de « {{ r.label }} » réaffectées à</label>
            <select [id]="'reassign-' + r.category.id" formControlName="reassignTo" aria-describedby="reassign-hint">
              <option value="">Aucune (catégorie inutilisée)</option>
              @for (t of targets(); track t.id) {
                <option [value]="t.id">{{ t.label }}</option>
              }
            </select>
            <p id="reassign-hint" class="field-hint">Obligatoire si la catégorie est utilisée par une transaction ou une récurrence.</p>
            <button class="button" type="submit">Confirmer la suppression</button>
            <button class="button button-secondary" type="button" (click)="deleting.set(null)">Annuler</button>
          </form>
        }
      </div>
    </ng-template>

    <h2>Nouvelle catégorie</h2>
    <form class="form" [formGroup]="form" (ngSubmit)="create()" novalidate>
      <div class="field">
        <label for="cat-name">Nom</label>
        <input id="cat-name" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="nameInvalid()" aria-describedby="cat-name-hint" />
        <p id="cat-name-hint" [class]="nameInvalid() ? 'field-error' : 'field-hint'">Obligatoire, 100 caractères au plus.</p>
      </div>
      <div class="field">
        <label for="cat-parent">Dans la catégorie (facultatif)</label>
        <select id="cat-parent" formControlName="parentId">
          <option value="">Aucune : catégorie principale</option>
          @for (c of parents(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label class="checkbox" for="cat-suggest">
          <input id="cat-suggest" type="checkbox" formControlName="suggest" [attr.disabled]="personalParent() ? '' : null" aria-describedby="cat-suggest-hint" />
          Proposer cette catégorie à tous
        </label>
        <p id="cat-suggest-hint" class="field-hint">
          @if (personalParent()) {
            Impossible sous une de vos catégories personnelles : choisissez une catégorie globale ou aucune.
          } @else {
            Facultatif. L'administrateur pourra l'ajouter pour tous les utilisateurs et vous répondre par une notification ;
            il ne voit pas votre adresse e-mail.
          }
        </p>
      </div>
      <button class="button" type="submit" [disabled]="pending()">Créer la catégorie</button>
    </form>

    @if (suggestions().length) {
      <h2>Mes suggestions</h2>
      <ul class="tree" aria-label="Mes suggestions">
        @for (s of suggestions(); track s.id) {
          <li class="card">
            <strong>{{ s.name }}</strong>@if (parentLabel(s.parentId); as parent) {<span class="muted"> dans « {{ parent }} »</span>}
            · {{ statusLabel[s.status] }}
          </li>
        }
      </ul>
    }
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
    .hidden-category strong {
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
export class CategoriesPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly all = signal<CategoryDto[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly deleting = signal<CategoryDto | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal('');
  protected readonly suggestions = signal<CategorySuggestionDto[]>([]);
  protected readonly statusLabel = SUGGESTION_STATUS_LABELS;

  protected readonly tree = computed(() => {
    const visible = this.all().filter((c) => !isTechnical(c));
    const toRow = (c: CategoryDto): Row => ({ category: c, label: categoryLabel(c), children: [] });
    const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label, 'fr');
    return visible
      .filter((c) => c.parentId === null)
      .map((c) => ({ ...toRow(c), children: visible.filter((k) => k.parentId === c.id).map(toRow).sort(byLabel) }))
      .sort(byLabel);
  });
  /** Parents possibles d'une nouvelle catégorie : racines proposées à la saisie (2 niveaux max). */
  protected readonly parents = computed(() => categoryOptions(this.all(), null));
  /** Cibles de réaffectation : toute catégorie non technique ni archivée sauf celle supprimée. */
  protected readonly targets = computed(() =>
    this.tree()
      .flatMap((r) => [r, ...r.children.map((k) => ({ ...k, label: `${r.label} › ${k.label}` }))])
      .filter((r) => r.category.id !== this.deleting()?.id && !r.category.archived)
      .map((r) => ({ id: r.category.id, label: r.label })),
  );

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
    parentId: [''],
    suggest: [false],
  });
  protected readonly renameForm = this.fb.group({ name: [''] });
  protected readonly deleteForm = this.fb.group({ reassignTo: [''] });

  constructor() {
    this.reload();
    this.reloadSuggestions();
  }

  private reloadSuggestions(): void {
    this.api.get<CategorySuggestionDto[]>('/categories/suggestions').subscribe({ next: (list) => this.suggestions.set(list), error: (e) => this.error.set(errorMessage(e)) });
  }

  /** Une catégorie sous une perso n'est pas proposable à tous (son parent n'existe que pour soi). */
  protected personalParent(): boolean {
    const parentId = this.form.controls.parentId.value;
    return this.all().some((c) => c.id === parentId && !c.system);
  }

  protected parentLabel(id: string | null): string | null {
    const parent = this.all().find((c) => c.id === id);
    return parent ? categoryLabel(parent) : null;
  }

  private reload(): void {
    this.api.get<CategoryDto[]>('/categories').subscribe({ next: (list) => this.all.set(list), error: (e) => this.error.set(errorMessage(e)) });
  }

  private done(message: string): void {
    this.error.set(null);
    this.status.set(message);
    this.reload();
  }

  /** Nom global, avant renommage pour soi : celui de l'admin, sinon la traduction du seed. */
  protected originalLabel(c: CategoryDto): string {
    return c.name ?? CATEGORY_LABELS[c.nameKey ?? ''] ?? c.nameKey ?? '';
  }

  protected nameInvalid(): boolean {
    const c = this.form.controls.name;
    return c.invalid && c.touched;
  }

  protected startRename(c: CategoryDto): void {
    this.deleting.set(null);
    this.renameForm.setValue({ name: categoryLabel(c) });
    this.editing.set(c.id);
  }

  // Globale : nom pour soi seul (vide ⇒ nom d'origine). Perso : renommage de la catégorie elle-même.
  protected saveName(c: CategoryDto): void {
    const name = this.renameForm.getRawValue().name.trim();
    this.editing.set(null);
    if (c.system) return this.setPreference(c, { customName: name && name !== this.originalLabel(c) ? name : null });
    if (!name) return;
    this.api.patch<CategoryDto>(`/categories/${c.id}`, { name }).subscribe({
      next: () => this.done(`Catégorie renommée en « ${name} ».`),
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette catégorie n’existe plus.' })),
    });
  }

  // PUT remplace la préférence entière : on repart des valeurs actuelles.
  protected setPreference(c: CategoryDto, change: Partial<CategoryPreferenceInput>): void {
    const body: CategoryPreferenceInput = { hidden: c.hidden, customName: c.customName, ...change };
    this.api.put<CategoryDto>(`/categories/${c.id}/preference`, body).subscribe({
      next: (updated) => this.done(`« ${categoryLabel(updated)} » ${updated.hidden ? 'masquée' : 'mise à jour'}.`),
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette catégorie n’existe plus.' })),
    });
  }

  protected startDelete(c: CategoryDto): void {
    this.editing.set(null);
    this.deleteForm.setValue({ reassignTo: '' });
    this.deleting.set(c);
  }

  protected confirmDelete(c: CategoryDto): void {
    const target = this.deleteForm.getRawValue().reassignTo;
    this.api.delete(`/categories/${c.id}${target ? `?reassignTo=${target}` : ''}`).subscribe({
      next: () => {
        this.deleting.set(null);
        this.done(`Catégorie « ${categoryLabel(c)} » supprimée.`);
      },
      error: (e) =>
        this.error.set(
          errorMessage(e, {
            409: c.parentId === null && this.all().some((k) => k.parentId === c.id)
              ? 'Supprimez ou déplacez d’abord ses sous-catégories.'
              : 'Catégorie utilisée : choisissez une catégorie de remplacement.',
            404: 'Cette catégorie ou la catégorie de remplacement n’existe plus.',
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
    const suggest = this.form.controls.suggest.value && !this.personalParent();
    const body: CreateCategoryInput = { name: name.trim(), ...(parentId ? { parentId } : {}), ...(suggest ? { suggest } : {}) };
    this.pending.set(true);
    this.api.post<CategoryDto>('/categories', body).subscribe({
      next: () => {
        this.pending.set(false);
        this.form.reset();
        this.done(`Catégorie « ${body.name} » créée${suggest ? ' et proposée à tous' : ''}.`);
        if (suggest) this.reloadSuggestions();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            404: 'La catégorie parente n’existe plus.',
            422: 'Deux niveaux de catégories au maximum.',
            429: 'Vous avez déjà beaucoup de suggestions en attente : attendez que l’administrateur les traite.',
          }),
        );
      },
    });
  }
}
