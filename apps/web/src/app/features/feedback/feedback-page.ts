import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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

// E39 (SPEC §13.5) : retour libre vers l'administrateur et liste de ses propres retours. Texte brut (interpolation).
@Component({
  selector: 'app-feedback-page',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Donner mon avis</h1>
    <p class="muted">
      Un avis, une idée de fonctionnalité, un problème : votre message est lu par l'administrateur. N'y mettez ni mot de
      passe ni donnée bancaire. Il est supprimé {{ retention.afterTreatedDays }} jours après son traitement, et au plus
      tard {{ retention.untreatedDays }} jours après son envoi.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="feedback-type">Type</label>
        <select id="feedback-type" formControlName="type">
          @for (t of types; track t.value) {
            <option [value]="t.value">{{ t.label }}</option>
          }
        </select>
      </div>
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
      <button class="button" type="submit" [disabled]="pending()">Envoyer</button>
    </form>

    <h2>Mes retours</h2>
    <ul class="list" aria-label="Mes retours">
      @for (f of list(); track f.id) {
        <li class="card">
          <p>
            <strong>{{ typeLabel(f.type) }}</strong> · {{ dateTime(f.createdAt) }} · {{ statusLabel(f.status) }}
          </p>
          <p class="message">{{ f.message }}</p>
        </li>
      } @empty {
        <li class="muted">Aucun retour envoyé.</li>
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
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
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
  protected readonly dateTime = (iso: string) => DATE_TIME.format(new Date(iso));

  protected readonly list = signal<FeedbackDto[]>([]);
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
      next: () => {
        this.pending.set(false);
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
