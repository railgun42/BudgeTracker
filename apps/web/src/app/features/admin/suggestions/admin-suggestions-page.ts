import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CategoryDto,
  CategorySuggestionDecision,
  CategorySuggestionDto,
  CategorySuggestionStatus,
  NOTIFICATION_MAX_LENGTH,
  ResolveCategorySuggestionInput,
} from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
import { categoryLabel } from '../../../shared-ui/labels';
import { errorMessage } from '../../auth/auth-form';
import { SUGGESTION_STATUS_LABELS } from '../../categories/categories-page';
import { DATE_TIME } from '../../feedback/feedback-page';

const DECISIONS: { value: CategorySuggestionDecision; label: string }[] = [
  { value: 'ACCEPTED', label: 'Accepter' },
  { value: 'REJECTED', label: 'Refuser' },
  { value: 'TREATED', label: 'Marquer comme traitée' },
];

/** Réponse proposée à l'auteur, modifiable avant envoi. */
export function defaultReply(decision: CategorySuggestionDecision, name: string): string {
  const seen = `J'ai vu ta suggestion de la catégorie ${name}`;
  if (decision === 'ACCEPTED') return `${seen}, je l'ai ajoutée, merci !`;
  if (decision === 'REJECTED') return `${seen}, je ne l'ai pas retenue pour le moment, merci quand même !`;
  return `${seen}, merci !`;
}

// E41 (SPEC §13.5) : suggestions de catégorie globale, sans auteur ni e-mail. Accepter crée la catégorie globale ;
// la réponse facultative part en notification personnelle à l'auteur. Texte brut. Route réservée aux admins.
@Component({
  selector: 'app-admin-suggestions-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p><a routerLink="/admin">← Administration</a></p>
    <h1>Suggestions de catégorie</h1>
    <p class="muted">
      Accepter rend la catégorie de l'auteur globale. Elle est masquée par défaut chez les utilisateurs déjà inscrits,
      qui peuvent l'afficher depuis « Mes catégories ». Si elle existe déjà, marquez la suggestion comme traitée.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <form class="filters" [formGroup]="filters" aria-label="Filtres">
      <div class="field">
        <label for="filter-status">Statut</label>
        <select id="filter-status" formControlName="status">
          <option value="">Tous</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </div>
    </form>

    <ul class="list" aria-label="Suggestions">
      @for (s of list(); track s.id) {
        <li class="card">
          <p>
            <strong class="name">{{ s.name }}</strong>
            @if (parentLabel(s.parentId); as parent) {
              <span class="muted"> dans « {{ parent }} »</span>
            }
            · {{ dateTime(s.createdAt) }} · {{ statusLabel[s.status] }}
          </p>
          @if (deciding()?.id === s.id) {
            <form class="form" [formGroup]="replyForm" (ngSubmit)="resolve(s)" novalidate>
              <div class="field">
                <label class="checkbox" [for]="'send-' + s.id">
                  <input [id]="'send-' + s.id" type="checkbox" formControlName="send" />
                  Répondre à l'auteur par une notification
                </label>
              </div>
              @if (replyForm.controls.send.value) {
                <div class="field">
                  <label [for]="'reply-' + s.id">Réponse</label>
                  <textarea [id]="'reply-' + s.id" formControlName="reply" rows="3" [attr.maxlength]="maxLength"></textarea>
                </div>
              }
              <div class="actions">
                <button class="button" type="submit">Confirmer : {{ decisionLabel(deciding()!.decision) }}</button>
                <button class="button button-secondary" type="button" (click)="deciding.set(null)">Annuler</button>
              </div>
            </form>
          } @else if (s.status === 'PENDING') {
            <div class="actions">
              @for (d of decisions; track d.value) {
                <button type="button" class="button button-secondary" (click)="start(s, d.value)">
                  {{ d.label }}<span class="visually-hidden"> « {{ s.name }} »</span>
                </button>
              }
            </div>
          }
        </li>
      } @empty {
        <li class="muted">Aucune suggestion.</li>
      }
    </ul>
  `,
  styles: `
    .list {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .card {
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }
    .name {
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class AdminSuggestionsPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly decisions = DECISIONS;
  protected readonly statuses = Object.entries(SUGGESTION_STATUS_LABELS) as [CategorySuggestionStatus, string][];
  protected readonly statusLabel = SUGGESTION_STATUS_LABELS;
  protected readonly maxLength = NOTIFICATION_MAX_LENGTH;
  protected readonly dateTime = (iso: string) => DATE_TIME.format(new Date(iso));
  protected readonly decisionLabel = (d: CategorySuggestionDecision) => DECISIONS.find((x) => x.value === d)!.label.toLowerCase();

  protected readonly list = signal<CategorySuggestionDto[]>([]);
  private readonly categories = signal<CategoryDto[]>([]);
  protected readonly deciding = signal<{ id: string; decision: CategorySuggestionDecision } | null>(null);
  protected readonly error = signal('');
  protected readonly status = signal('');

  protected readonly filters = this.fb.group({ status: '' as CategorySuggestionStatus | '' });
  protected readonly replyForm = this.fb.group({ send: true, reply: ['', [Validators.maxLength(NOTIFICATION_MAX_LENGTH)]] });

  constructor() {
    this.filters.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    this.reload();
    // Libellé du parent : catégories globales (archivées comprises).
    this.api.get<CategoryDto[]>('/admin/categories').subscribe({ next: (list) => this.categories.set(list) });
  }

  private reload(): void {
    const { status } = this.filters.getRawValue();
    this.api.get<CategorySuggestionDto[]>('/admin/category-suggestions', { status: status || undefined }).subscribe({
      next: (list) => this.list.set(list),
      error: (e) => this.error.set(errorMessage(e, { 403: 'Accès réservé aux administrateurs.' })),
    });
  }

  protected parentLabel(id: string | null): string | null {
    const parent = this.categories().find((c) => c.id === id);
    return parent ? categoryLabel(parent) : null;
  }

  protected start(s: CategorySuggestionDto, decision: CategorySuggestionDecision): void {
    this.replyForm.setValue({ send: true, reply: defaultReply(decision, s.name) });
    this.deciding.set({ id: s.id, decision });
  }

  // Réponse vide ou décochée ⇒ aucune notification.
  protected resolve(s: CategorySuggestionDto): void {
    const { decision } = this.deciding()!;
    const { send, reply } = this.replyForm.getRawValue();
    const body: ResolveCategorySuggestionInput = { decision, ...(send && reply.trim() ? { reply: reply.trim() } : {}) };
    this.api.post<CategorySuggestionDto>(`/admin/category-suggestions/${s.id}/resolve`, body).subscribe({
      next: () => {
        this.deciding.set(null);
        this.error.set('');
        this.status.set(`Suggestion « ${s.name} » : ${this.statusLabel[decision].toLowerCase()}${body.reply ? ', réponse envoyée' : ''}.`);
        this.reload();
      },
      error: (e) =>
        this.error.set(
          errorMessage(e, {
            409:
              decision === 'ACCEPTED'
                ? 'Suggestion déjà traitée, ou une catégorie globale porte déjà ce nom à cet endroit : marquez-la alors comme traitée.'
                : 'Suggestion déjà traitée.',
            422: 'La catégorie parente est archivée : restaurez-la ou marquez la suggestion comme traitée.',
            404: 'Cette suggestion n’existe plus.',
          }),
        ),
    });
  }
}
