import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_SUGGESTION_MAX_PENDING,
  CategoryDto,
  CategorySuggestionDecision,
  CategorySuggestionDto,
  CategorySuggestionStatus,
  NOTIFICATION_MAX_LENGTH,
  ResolveCategorySuggestionInput,
} from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
import { categoryIcon, TAG_ICON } from '../../../shared-ui/category-icons';
import { categoryLabel } from '../../../shared-ui/labels';
import { errorMessage } from '../../auth/auth-form';
import { SUGGESTION_STATUS_LABELS } from '../../categories/categories-page';
import { NOTIFICATION_ICONS, notificationKindLabel } from '../../notifications/notifications';

const DECISIONS: { value: CategorySuggestionDecision; label: string }[] = [
  { value: 'ACCEPTED', label: 'Accepter' },
  { value: 'REJECTED', label: 'Refuser' },
  { value: 'TREATED', label: 'Marquer comme traitée' },
];

// Affichage seulement : conséquence de la décision, rappelée dans la modale.
const CONSEQUENCES: Record<CategorySuggestionDecision, string> = {
  ACCEPTED: 'La catégorie devient globale. Elle est masquée par défaut chez les utilisateurs déjà inscrits.',
  REJECTED: 'La suggestion est refusée : aucune catégorie globale n’est créée.',
  TREATED: 'La suggestion est close sans créer de catégorie, par exemple si elle existe déjà.',
};

// Icônes au trait des statuts (décoratives, le statut reste écrit) : horloge, coche, croix, double coche.
const STATUS_ICONS: Record<CategorySuggestionStatus, string> = {
  PENDING: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  ACCEPTED: 'M5 12l5 5 9-10',
  REJECTED: 'M6 6l12 12M18 6 6 18',
  TREATED: 'M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16',
};

// Affichage seulement, fuseau du navigateur : « 15 oct. 2026, 10:00 ».
const READABLE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const s = (n: number) => (n > 1 ? 's' : '');

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
    <header class="head">
      <p class="back"><a routerLink="/admin">← Administration</a></p>
      <div class="page-head">
        <h1>Suggestions de catégorie</h1>
        @if (list()?.length) {
          <!-- Compteurs de la liste affichée (déjà filtrée par le serveur), pas des totaux. -->
          <p class="muted counts">
            {{ list()!.length }} suggestion{{ plural(list()!.length) }} affichée{{ plural(list()!.length) }}, dont
            {{ pendingCount() }} en attente
          </p>
        }
      </div>
      <p class="muted intro">
        Accepter rend la catégorie de l'auteur globale. Elle est masquée par défaut chez les utilisateurs déjà inscrits,
        qui peuvent l'afficher depuis « Mes catégories ». Si elle existe déjà, marquez la suggestion comme traitée.
      </p>
      <p class="muted intro">
        Chaque utilisateur peut avoir au plus {{ maxPending }} suggestions en attente : au-delà, ses nouvelles
        propositions sont refusées jusqu'à ce que vous en traitiez.
      </p>
    </header>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        <button type="button" class="link-button" (click)="error.set(''); reload()">Recharger</button>
      </p>
    }
    <div aria-live="polite">
      @if (status() && !error()) {
        <p class="alert alert-success confirm-pop">{{ status() }}</p>
      }
    </div>

    <form class="filters" [formGroup]="filters" aria-label="Filtres">
      <div class="field">
        <label for="filter-status">Statut</label>
        <select id="filter-status" formControlName="status">
          <option value="">Tous</option>
          @for (st of statuses; track st[0]) {
            <option [value]="st[0]">{{ st[1] }}</option>
          }
        </select>
      </div>
    </form>

    @if (list(); as all) {
      @if (all.length) {
        <ul class="card rows" aria-label="Suggestions">
          @for (s of all; track s.id) {
            <li class="row" [class.confirm-pop]="s.id === decided()">
              <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="parentIcon(s.parentId)" /></svg>
              <div class="row-body">
                <p class="row-head">
                  <span class="title"
                    ><strong class="name">{{ s.name }}</strong>
                    @if (parentLabel(s.parentId); as parent) {
                      <span class="muted"> dans « {{ parent }} »</span>
                    }</span
                  ><span class="visually-hidden"> · </span>
                  <time class="muted" [attr.datetime]="s.createdAt">{{ dateTime(s.createdAt) }}</time
                  ><span class="visually-hidden"> · </span>
                  <span class="badge badge-neutral status">
                    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="statusIcons[s.status]" /></svg>
                    {{ statusLabel[s.status] }}
                  </span>
                </p>
                @if (s.status === 'PENDING') {
                  <div class="row-actions">
                    @for (d of decisions; track d.value) {
                      <button type="button" class="button button-secondary" (click)="start(s, d.value)">
                        {{ d.label }}<span class="visually-hidden"> « {{ s.name }} »</span>
                      </button>
                    }
                  </div>
                }
              </div>
            </li>
          }
        </ul>
      } @else if (filters.controls.status.value) {
        <p class="empty muted">Aucune suggestion ne correspond à ce filtre.</p>
      } @else {
        <p class="empty muted">Aucune suggestion.</p>
      }
    } @else if (!error()) {
      <p class="muted" role="status">Chargement…</p>
    }

    <!-- Décision : modale ; page derrière inerte, d'où l'erreur serveur répétée dedans. Elle reste ouverte sur erreur. -->
    <dialog #decideDialog class="modal" aria-labelledby="decide-title" (close)="deciding.set(null)">
      @if (decidingRow(); as d) {
        <h2 id="decide-title">{{ d.label }} « {{ d.suggestion.name }} » ?</h2>
        @if (error()) {
          <p class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <p>{{ d.consequence }}</p>
        <form class="form" [formGroup]="replyForm" (ngSubmit)="resolve(d.suggestion)" novalidate>
          <div class="field">
            <label class="checkbox" [for]="'send-' + d.suggestion.id">
              <input [id]="'send-' + d.suggestion.id" type="checkbox" formControlName="send" />
              Répondre à l'auteur par une notification
            </label>
          </div>
          @if (replyForm.controls.send.value) {
            <div class="field">
              <label [for]="'reply-' + d.suggestion.id">Réponse</label>
              <textarea
                [id]="'reply-' + d.suggestion.id"
                formControlName="reply"
                rows="4"
                [attr.maxlength]="maxLength"
                [attr.aria-invalid]="replyInvalid()"
                [attr.aria-describedby]="'reply-' + d.suggestion.id + '-hint reply-' + d.suggestion.id + '-count'"
              ></textarea>
              <p [id]="'reply-' + d.suggestion.id + '-hint'" [class]="replyInvalid() ? 'field-error' : 'field-hint'">
                Préremplie selon la décision, modifiable. {{ maxLength }} caractères au plus, texte brut ; vide : aucune
                notification.
              </p>
              @if (replyText().length >= nearMax) {
                <p [id]="'reply-' + d.suggestion.id + '-count'" class="field-warning">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="warningIcon" /></svg>
                  {{ replyText().length }} / {{ maxLength }} caractères : plus que {{ maxLength - replyText().length }}.
                </p>
              } @else {
                <p [id]="'reply-' + d.suggestion.id + '-count'" class="field-hint">{{ replyText().length }} / {{ maxLength }} caractères.</p>
              }
            </div>
            @if (replyText().trim()) {
              <!-- Aperçu : même ligne que la page Notifications (§3.13), texte brut tel qu'il sera envoyé (rogné). -->
              <figure class="preview">
                <figcaption class="muted">Aperçu, tel que l'auteur le verra</figcaption>
                <div class="preview-row unread-row">
                  <p class="row-head">
                    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="notificationIcon" /></svg>
                    <strong>{{ kindLabel }}</strong><span class="visually-hidden"> · </span>
                    <span class="muted">À l'envoi</span><span class="visually-hidden"> · </span>
                    <span class="unread-mark">Non lue</span>
                  </p>
                  <p class="message">{{ replyText().trim() }}</p>
                </div>
              </figure>
            }
          }
          <div class="actions">
            <button class="button" type="submit" [disabled]="resolving()">
              {{ resolving() ? 'Décision en cours…' : 'Confirmer : ' + decisionLabel(d.decision) }}
            </button>
            <button class="button button-secondary" type="button" (click)="decideDialog.close()">Annuler</button>
          </div>
        </form>
      }
    </dialog>
  `,
  // Mise en page seulement : champs, bandeaux, pastilles, modale, icône de catégorie et boutons viennent de la charte.
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
      max-width: 40rem;
    }
    // Lien retour, titre et explications forment un seul bloc.
    .head {
      display: grid;
      gap: var(--space-2);
    }
    .back,
    h1,
    .intro,
    .counts,
    .alert {
      margin: 0;
    }
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-1) var(--space-3);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding-block: 0;
    }
    // Icône du parent à gauche, contenu aligné à droite d'elle.
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-3);
      padding: var(--space-4) 0;
      + .row {
        border-top: 1px solid var(--color-border);
      }
      p {
        margin: 0;
      }
    }
    .row-body {
      display: grid;
      gap: var(--space-3);
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      font-size: var(--text-sm);
    }
    // Nom et parent sur leur propre ligne, en taille courante ; date et statut dessous.
    .title {
      flex-basis: 100%;
      font-size: var(--text-base);
    }
    .name {
      overflow-wrap: anywhere;
    }
    .icon {
      flex: none;
      width: 1.25em;
      height: 1.25em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      margin-left: auto;
    }
    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .empty {
      margin: 0;
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    .modal > p {
      margin: 0 0 var(--space-3);
    }
    .form {
      max-width: none;
      margin: 0;
    }
    // Aperçu : cadre pointillé pour le distinguer d'une vraie notification (comme §4.4).
    .preview {
      display: grid;
      gap: var(--space-1);
      margin: 0;
      figcaption {
        font-size: var(--text-sm);
      }
    }
    .preview-row {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-3);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      p {
        margin: 0;
      }
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class AdminSuggestionsPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly decisions = DECISIONS;
  protected readonly statuses = Object.entries(SUGGESTION_STATUS_LABELS) as [CategorySuggestionStatus, string][];
  protected readonly statusLabel = SUGGESTION_STATUS_LABELS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly maxLength = NOTIFICATION_MAX_LENGTH;
  protected readonly maxPending = CATEGORY_SUGGESTION_MAX_PENDING;
  protected readonly nearMax = Math.ceil(NOTIFICATION_MAX_LENGTH * 0.9);
  protected readonly plural = s;
  protected readonly dateTime = (iso: string) => READABLE.format(new Date(iso));
  protected readonly decisionLabel = (d: CategorySuggestionDecision) => DECISIONS.find((x) => x.value === d)!.label.toLowerCase();
  protected readonly notificationIcon = NOTIFICATION_ICONS.PERSONAL;
  protected readonly kindLabel = notificationKindLabel('PERSONAL');
  protected readonly warningIcon = 'M12 3 2 21h20L12 3zM12 10v5M12 18v.01';

  // null tant que la liste n'est pas chargée (« Chargement… »).
  protected readonly list = signal<CategorySuggestionDto[] | null>(null);
  protected readonly pendingCount = computed(() => (this.list() ?? []).filter((x) => x.status === 'PENDING').length);
  private readonly categories = signal<CategoryDto[]>([]);
  protected readonly deciding = signal<{ id: string; decision: CategorySuggestionDecision } | null>(null);
  protected readonly decidingRow = computed(() => {
    const d = this.deciding();
    const suggestion = d && this.list()?.find((x) => x.id === d.id);
    if (!d || !suggestion) return null;
    return { ...d, suggestion, label: DECISIONS.find((x) => x.value === d.decision)!.label, consequence: CONSEQUENCES[d.decision] };
  });
  protected readonly resolving = signal(false);
  /** Dernière suggestion décidée : sa ligne rejoue confirm-pop. */
  protected readonly decided = signal('');
  protected readonly error = signal('');
  protected readonly status = signal('');

  protected readonly filters = this.fb.group({ status: '' as CategorySuggestionStatus | '' });
  protected readonly replyForm = this.fb.group({ send: true, reply: ['', [Validators.maxLength(NOTIFICATION_MAX_LENGTH)]] });
  // Affichage seulement : compteur, aperçu, état invalide.
  private readonly replyValue = toSignal(this.replyForm.valueChanges, { initialValue: this.replyForm.getRawValue() });
  protected readonly replyText = computed(() => this.replyValue().reply ?? '');
  protected readonly replyInvalid = computed(() => this.replyText().length > NOTIFICATION_MAX_LENGTH);
  private readonly decideDialog = viewChild.required<ElementRef<HTMLDialogElement>>('decideDialog');

  constructor() {
    this.filters.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    this.reload();
    // Libellé du parent : catégories globales (archivées comprises).
    this.api.get<CategoryDto[]>('/admin/categories').subscribe({ next: (list) => this.categories.set(list) });
  }

  protected reload(): void {
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

  /** Icône de la racine du parent ; étiquette pour une catégorie principale (comme celles créées par l'admin). */
  protected parentIcon(id: string | null): string {
    const parent = this.categories().find((c) => c.id === id);
    const root = parent?.parentId ? this.categories().find((c) => c.id === parent.parentId) : parent;
    return root ? categoryIcon(root) : TAG_ICON;
  }

  protected start(s: CategorySuggestionDto, decision: CategorySuggestionDecision): void {
    this.replyForm.setValue({ send: true, reply: defaultReply(decision, s.name) });
    this.error.set('');
    this.deciding.set({ id: s.id, decision });
    this.decideDialog().nativeElement.showModal();
  }

  // Réponse vide ou décochée ⇒ aucune notification.
  protected resolve(s: CategorySuggestionDto): void {
    const { decision } = this.deciding()!;
    const { send, reply } = this.replyForm.getRawValue();
    if (send && this.replyForm.invalid) return;
    const body: ResolveCategorySuggestionInput = { decision, ...(send && reply.trim() ? { reply: reply.trim() } : {}) };
    this.resolving.set(true);
    this.api.post<CategorySuggestionDto>(`/admin/category-suggestions/${s.id}/resolve`, body).subscribe({
      next: () => {
        this.resolving.set(false);
        this.decideDialog().nativeElement.close();
        this.decided.set(s.id);
        this.error.set('');
        this.status.set(`Suggestion « ${s.name} » : ${this.statusLabel[decision].toLowerCase()}${body.reply ? ', réponse envoyée' : ''}.`);
        this.reload();
      },
      error: (e) => {
        this.resolving.set(false);
        this.error.set(
          errorMessage(e, {
            409:
              decision === 'ACCEPTED'
                ? 'Suggestion déjà traitée, ou une catégorie globale porte déjà ce nom à cet endroit : marquez-la alors comme traitée.'
                : 'Suggestion déjà traitée.',
            422: 'La catégorie parente est archivée : restaurez-la ou marquez la suggestion comme traitée.',
            404: 'Cette suggestion n’existe plus.',
          }),
        );
      },
    });
  }
}
