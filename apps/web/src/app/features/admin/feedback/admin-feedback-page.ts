import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminFeedbackDto, AdminFeedbackSort, FEEDBACK_RETENTION, FeedbackStatus, FeedbackType } from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
import { errorMessage } from '../../auth/auth-form';
import { DATE_TIME, FEEDBACK_TYPES, feedbackStatusLabel, feedbackTypeLabel } from '../../feedback/feedback-page';

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

// E39 (SPEC §13.5) : boîte de réception des retours, filtrable par type et statut, triable. Ni auteur ni e-mail.
// Texte brut (interpolation). Route réservée aux admins.
@Component({
  selector: 'app-admin-feedback-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p><a routerLink="/admin">← Administration</a></p>
    <h1>Retours utilisateurs</h1>
    <p class="muted">
      Suppression automatique {{ retention.afterTreatedDays }} jours après le traitement, {{ retention.untreatedDays }}
      jours après l'envoi sinon.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    @if (expiring() > 0) {
      <p class="alert" role="status">
        {{ expiring() }} retour(s) non traité(s) seront supprimés automatiquement d'ici {{ retention.warnDays }} jours.
      </p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <form class="filters" [formGroup]="filters" aria-label="Filtres">
      <div class="field">
        <label for="filter-type">Type</label>
        <select id="filter-type" formControlName="type">
          <option value="">Tous</option>
          @for (t of types; track t.value) {
            <option [value]="t.value">{{ t.label }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="filter-status">Statut</label>
        <select id="filter-status" formControlName="status">
          <option value="">Tous</option>
          <option value="NEW">Nouveaux</option>
          <option value="TREATED">Traités</option>
        </select>
      </div>
      <div class="field">
        <label for="filter-sort">Trier par</label>
        <select id="filter-sort" formControlName="sort">
          <option value="date">Date</option>
          <option value="type">Type</option>
          <option value="status">Statut</option>
        </select>
      </div>
    </form>

    <ul class="list" aria-label="Retours">
      @for (f of list(); track f.id) {
        <li class="card" [class.expiring]="f.expiringSoon">
          <p>
            <strong>{{ typeLabel(f.type) }}</strong> · {{ dateTime(f.createdAt) }} · {{ statusLabel(f.status) }}
          </p>
          <p class="message">{{ f.message }}</p>
          <p class="muted">
            @if (f.expiringSoon) {
              <strong>Bientôt supprimé :</strong>
            }
            Suppression le {{ date(f.expiresAt) }}.
          </p>
          @if (f.status === 'NEW') {
            <button type="button" class="button button-secondary" (click)="treat(f)">
              Marquer comme traité<span class="visually-hidden"> ({{ typeLabel(f.type) }} du {{ dateTime(f.createdAt) }})</span>
            </button>
          }
        </li>
      } @empty {
        <li class="muted">Aucun retour.</li>
      }
    </ul>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
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
    .expiring {
      border-width: 2px;
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class AdminFeedbackPage {
  private readonly api = inject(ApiClient);

  protected readonly types = FEEDBACK_TYPES;
  protected readonly retention = FEEDBACK_RETENTION;
  protected readonly typeLabel = feedbackTypeLabel;
  protected readonly statusLabel = feedbackStatusLabel;
  protected readonly dateTime = (iso: string) => DATE_TIME.format(new Date(iso));
  protected readonly date = (iso: string) => DATE.format(new Date(iso));

  protected readonly list = signal<AdminFeedbackDto[]>([]);
  protected readonly expiring = computed(() => this.list().filter((f) => f.expiringSoon).length);
  protected readonly error = signal('');
  protected readonly status = signal('');

  protected readonly filters = inject(NonNullableFormBuilder).group({
    type: '' as FeedbackType | '',
    status: '' as FeedbackStatus | '',
    sort: 'date' as AdminFeedbackSort,
  });

  constructor() {
    this.filters.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    this.reload();
  }

  private reload(): void {
    const { type, status, sort } = this.filters.getRawValue();
    this.api.get<AdminFeedbackDto[]>('/admin/feedback', { type: type || undefined, status: status || undefined, sort }).subscribe({
      next: (list) => this.list.set(list),
      error: (e) => this.error.set(errorMessage(e, { 403: 'Accès réservé aux administrateurs.' })),
    });
  }

  protected treat(f: AdminFeedbackDto): void {
    this.api.post<AdminFeedbackDto>(`/admin/feedback/${f.id}/treat`).subscribe({
      next: () => {
        this.error.set('');
        this.status.set('Retour marqué comme traité.');
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Ce retour n’existe plus.' })),
    });
  }
}
