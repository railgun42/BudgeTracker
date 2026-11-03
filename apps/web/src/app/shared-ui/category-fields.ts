import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { CategoryDto } from '@budgetracker/shared';
import { startWith, switchMap } from 'rxjs';
import { categoryOptions } from './labels';

/**
 * Catégorie puis sous-catégorie : deux listes liées, toutes deux facultatives (SPEC §3.2). Les contrôles ('' = aucune)
 * appartiennent au formulaire de l'appelant ; ids `<idPrefix>-category` et `<idPrefix>-subcategory`.
 * Sous-catégorie masquée tant que la catégorie choisie n'en a pas ; changer de catégorie l'efface.
 */
@Component({
  selector: 'app-category-fields',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' }, // les deux champs restent des éléments directs de la grille du formulaire
  template: `
    <div class="field">
      <label [for]="idPrefix() + '-category'">Catégorie (facultatif)</label>
      <select [id]="idPrefix() + '-category'" [formControl]="category()" (change)="subcategory().setValue('')">
        <option value="">{{ emptyLabel() }}</option>
        @for (c of roots(); track c.id) {
          <option [value]="c.id">{{ c.label }}</option>
        }
      </select>
    </div>

    @if (subcategories().length) {
      <div class="field">
        <label [for]="idPrefix() + '-subcategory'">Sous-catégorie (facultatif)</label>
        <select [id]="idPrefix() + '-subcategory'" [formControl]="subcategory()">
          <option value="">Aucune</option>
          @for (c of subcategories(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </div>
    }
  `,
})
export class CategoryFields {
  readonly idPrefix = input.required<string>();
  readonly categories = input.required<CategoryDto[]>();
  readonly category = input.required<FormControl<string>>();
  readonly subcategory = input.required<FormControl<string>>();
  /** Libellé du choix vide (par défaut « Sans catégorie »). */
  readonly emptyLabel = input('Sans catégorie');

  protected readonly roots = computed(() => categoryOptions(this.categories(), null));
  private readonly categoryId = toSignal(toObservable(this.category).pipe(switchMap((c) => c.valueChanges.pipe(startWith(c.value)))), { initialValue: '' });
  protected readonly subcategories = computed(() => {
    const parentId = this.categoryId();
    return parentId ? categoryOptions(this.categories(), parentId) : [];
  });
}
