import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TagDto } from '@budgetracker/shared';
import { ApiClient } from '../core/api-client';
import { errorMessage } from '../features/auth/auth-form';

/** Plafond de l'API (`ArrayMaxSize` de tagIds) : refusé ici plutôt que par un 400. */
export const MAX_TAGS_PER_TRANSACTION = 20;

/**
 * Saisie de tags en puces : Entrée ajoute le tag de ce nom (créé par `POST /tags` s'il n'existe pas, sans tenir
 * compte de la casse), la croix le retire. `value` = ids choisis ; `tags` = tags connus, complétée des tags créés.
 */
@Component({
  selector: 'app-tag-input',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label [for]="inputId()">Tags (facultatif)</label>
      <input
        [id]="inputId()"
        [formControl]="text"
        maxlength="50"
        autocomplete="off"
        [attr.list]="inputId() + '-list'"
        [attr.aria-describedby]="inputId() + '-hint'"
        (keydown.enter)="add($event)"
      />
      <datalist [id]="inputId() + '-list'">
        @for (t of suggestions(); track t.id) {
          <option [value]="t.name"></option>
        }
      </datalist>
      <p [id]="inputId() + '-hint'" class="field-hint">Écrivez un mot puis Entrée. Plusieurs tags possibles.</p>
      @if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      }
      @if (chosen().length) {
        <ul class="tag-list" aria-label="Tags choisis">
          @for (t of chosen(); track t.id) {
            <li class="tag-chip">
              <span>{{ t.name }}</span>
              <button type="button" [attr.aria-label]="'Retirer le tag ' + t.name" (click)="remove(t)"><span aria-hidden="true">×</span></button>
            </li>
          }
        </ul>
      }
      <p class="visually-hidden" role="status">{{ status() }}</p>
    </div>
  `,
})
export class TagInput {
  private readonly api = inject(ApiClient);
  /** Distinct si plusieurs saisies sont affichées en même temps (libellé et liste reliés par id). */
  readonly inputId = input('tag-input');
  readonly tags = model.required<TagDto[]>();
  readonly value = model<string[]>([]);

  protected readonly text = new FormControl('', { nonNullable: true });
  protected readonly status = signal('');
  protected readonly error = signal<string | null>(null);
  private creating = false;

  protected readonly chosen = computed(() => {
    const byId = new Map(this.tags().map((t) => [t.id, t]));
    return this.value().flatMap((id) => byId.get(id) ?? []);
  });
  protected readonly suggestions = computed(() => this.tags().filter((t) => !this.value().includes(t.id)));

  protected add(event: Event): void {
    event.preventDefault(); // Entrée ne doit pas envoyer le formulaire.
    const name = this.text.value.trim();
    if (!name || this.creating) return;
    this.error.set(null);
    const known = this.tags().find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (known) return this.select(known);
    if (this.value().length >= MAX_TAGS_PER_TRANSACTION) return this.error.set(`${MAX_TAGS_PER_TRANSACTION} tags au maximum.`);
    this.creating = true;
    this.api.post<TagDto>('/tags', { name }).subscribe({
      next: (tag) => {
        this.creating = false;
        this.tags.update((list) => [...list, tag]);
        this.select(tag);
      },
      error: (e) => {
        this.creating = false;
        this.error.set(errorMessage(e, { 409: 'Ce tag existe déjà. Rechargez la page.' }));
      },
    });
  }

  protected remove(tag: TagDto): void {
    this.value.update((ids) => ids.filter((id) => id !== tag.id));
    this.status.set(`Tag ${tag.name} retiré.`);
  }

  private select(tag: TagDto): void {
    this.text.reset();
    if (this.value().includes(tag.id)) return this.status.set(`Le tag ${tag.name} est déjà ajouté.`);
    if (this.value().length >= MAX_TAGS_PER_TRANSACTION) return this.error.set(`${MAX_TAGS_PER_TRANSACTION} tags au maximum.`);
    this.value.update((ids) => [...ids, tag.id]);
    this.status.set(`Tag ${tag.name} ajouté.`);
  }
}
