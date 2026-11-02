import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CreateFeedbackInput, FEEDBACK_LIMITS, FEEDBACK_RETENTION, FeedbackDto, FeedbackStatus, FeedbackType } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';

export const FEEDBACK_TYPES: { value: FeedbackType; label: string }[] = [
  { value: FeedbackType.OPINION, label: 'Avis' },
  { value: FeedbackType.IDEA, label: 'Idée de fonctionnalité' },
  { value: FeedbackType.PROBLEM, label: 'Problème' },
];
export const feedbackTypeLabel = (type: FeedbackType) => FEEDBACK_TYPES.find((t) => t.value === type)!.label;
export const feedbackStatusLabel = (status: FeedbackStatus) => (status === 'NEW' ? 'Nouveau' : 'Traité');
export const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

const { maxMessageLength, perDay, maxUntreated } = FEEDBACK_LIMITS;
// Affichage seulement : « 15 oct. 2026, 10:00 » dans le fuseau du navigateur.
const READABLE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
// Icônes décoratives au trait (viewBox 24) : le libellé reste écrit à côté.
export const TYPE_ICONS: Record<FeedbackType, string> = {
  [FeedbackType.OPINION]: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  [FeedbackType.IDEA]: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  [FeedbackType.PROBLEM]: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
};
export const STATUS_ICONS: Record<FeedbackStatus, string> = {
  NEW: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  TREATED: 'M5 12l5 5 9-10',
};
type Filter = FeedbackStatus | 'ALL';

// E39 (SPEC §13.5) : retour libre vers l'administrateur et liste de ses propres retours. Texte brut (interpolation).
@Component({
  selector: 'app-feedback-page',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Donner mon avis</h1>
    <p class="muted intro">
      Un avis, une idée de fonctionnalité, un problème : votre message est lu par l'administrateur. N'y mettez ni mot de
      passe ni donnée bancaire. Il est supprimé {{ retention.afterTreatedDays }} jours après son traitement, et au plus
      tard {{ retention.untreatedDays }} jours après son envoi.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <div aria-live="polite">
      @if (status()) {
        <p class="alert alert-success confirm-pop">{{ status() }}</p>
      }
    </div>

    <section class="card" aria-label="Nouveau message">
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <fieldset class="field" id="feedback-type">
          <legend>Type</legend>
          <div class="chips">
            @for (t of types; track t.value) {
              <label class="chip">
                <input type="radio" name="type" formControlName="type" [id]="'feedback-type-' + t.value" [value]="t.value" />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[t.value]" /></svg>
                {{ t.label }}
              </label>
            }
          </div>
        </fieldset>
        <div class="field">
          <label for="feedback-message">Message</label>
          <textarea
            id="feedback-message"
            formControlName="message"
            rows="6"
            [attr.maxlength]="max"
            [attr.aria-invalid]="messageInvalid()"
            aria-describedby="feedback-message-hint"
          ></textarea>
          <p id="feedback-message-hint" [class]="messageInvalid() ? 'field-error' : 'field-hint'">
            Obligatoire, {{ message().length }} / {{ max }} caractères.
          </p>
        </div>
        <div class="actions">
          <button class="button" type="submit" [disabled]="pending()">{{ pending() ? 'Envoi en cours…' : 'Envoyer' }}</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h2 class="card-title">Mes retours</h2>
      @if (list(); as all) {
        @if (all.length) {
          <div class="segmented filter" role="group" aria-label="Filtrer par statut">
            @for (f of filters; track f.value) {
              <button type="button" [attr.aria-pressed]="filter() === f.value" (click)="filter.set(f.value)">
                {{ f.label }} ({{ count(f.value) }})
              </button>
            }
          </div>
          @if (shown().length) {
            <ul class="rows" aria-label="Mes retours">
              @for (f of shown(); track f.id) {
                <li class="row" [class.confirm-pop]="f.id === createdId()">
                  <p class="row-head">
                    <svg class="icon type-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[f.type]" /></svg>
                    <strong>{{ typeLabel(f.type) }}</strong><span class="visually-hidden"> · </span>
                    <time class="muted" [attr.datetime]="f.createdAt">{{ dateTime(f.createdAt) }}</time
                    ><span class="visually-hidden"> · </span>
                    <span class="badge badge-neutral status">
                      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="statusIcons[f.status]" /></svg>
                      {{ statusLabel(f.status) }}
                    </span>
                  </p>
                  <p class="message">{{ f.message }}</p>
                </li>
              }
            </ul>
          } @else {
            <p class="empty muted">Aucun retour {{ filter() === 'NEW' ? 'nouveau' : 'traité' }}.</p>
          }
        } @else {
          <p class="empty muted">Aucun retour envoyé.</p>
        }
      } @else if (!error()) {
        <p class="muted" role="status">Chargement…</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
      max-width: 40rem;
    }
    h1,
    .intro,
    .alert {
      margin: 0;
    }
    .form {
      max-width: none;
    }
    .filter {
      margin-block: var(--space-2) var(--space-1);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .row {
      display: grid;
      gap: var(--space-1);
      padding-block: var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
      p {
        margin: 0;
      }
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      font-size: var(--text-sm);
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
    .type-icon {
      color: var(--color-primary);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      margin-left: auto;
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .empty {
      margin: var(--space-2) 0 0;
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
  `,
})
export class FeedbackPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly types = FEEDBACK_TYPES;
  protected readonly max = maxMessageLength;
  protected readonly retention = FEEDBACK_RETENTION;
  protected readonly typeLabel = feedbackTypeLabel;
  protected readonly statusLabel = feedbackStatusLabel;
  protected readonly dateTime = (iso: string) => READABLE.format(new Date(iso));
  protected readonly icons = TYPE_ICONS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'ALL', label: 'Tous' },
    { value: 'NEW', label: feedbackStatusLabel('NEW') },
    { value: 'TREATED', label: feedbackStatusLabel('TREATED') },
  ];

  // null tant que la liste n'est pas chargée (« Chargement… »).
  protected readonly list = signal<FeedbackDto[] | null>(null);
  protected readonly filter = signal<Filter>('ALL');
  protected readonly shown = computed(() => (this.list() ?? []).filter((f) => this.filter() === 'ALL' || f.status === this.filter()));
  protected readonly count = (v: Filter) => (this.list() ?? []).filter((f) => v === 'ALL' || f.status === v).length;
  protected readonly createdId = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected readonly status = signal('');

  protected readonly form = this.fb.group({
    type: [FeedbackType.OPINION],
    message: ['', [Validators.required, Validators.maxLength(maxMessageLength), Validators.pattern(/\S/)]],
  });
  protected readonly message = toSignal(this.form.controls.message.valueChanges, { initialValue: '' });

  constructor() {
    this.reload();
  }

  private reload(): void {
    this.api.get<FeedbackDto[]>('/feedback').subscribe({ next: (list) => this.list.set(list), error: (e) => this.error.set(errorMessage(e)) });
  }

  protected messageInvalid(): boolean {
    const c = this.form.controls.message;
    return c.invalid && c.touched;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { type, message } = this.form.getRawValue();
    const body: CreateFeedbackInput = { type, message: message.trim() };
    this.pending.set(true);
    this.api.post<FeedbackDto>('/feedback', body).subscribe({
      next: (created) => {
        this.pending.set(false);
        this.createdId.set(created.id);
        this.error.set('');
        this.form.reset();
        this.status.set('Merci, votre message a été envoyé.');
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            400: `Message vide ou trop long (${maxMessageLength} caractères au plus).`,
            429: `Limite atteinte : ${perDay} messages par 24 h et ${maxUntreated} en attente de traitement au plus. Réessayez plus tard.`,
          }),
        );
      },
    });
  }
}
