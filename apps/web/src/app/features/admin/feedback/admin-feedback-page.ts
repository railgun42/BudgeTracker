import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminFeedbackDto, AdminFeedbackSort, FEEDBACK_RETENTION, FeedbackStatus, FeedbackType } from '@budgetracker/shared';
import { ApiClient } from '../../../core/api-client';
import { errorMessage } from '../../auth/auth-form';
import { FEEDBACK_TYPES, feedbackStatusLabel, feedbackTypeLabel, STATUS_ICONS, TYPE_ICONS } from '../../feedback/feedback-page';

// Affichage seulement, fuseau du navigateur : « 15 oct. 2026, 10:00 » et « 13 janv. 2027 ».
const READABLE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const s = (n: number, plural = 's') => (n > 1 ? plural : '');

// E39 (SPEC §13.5) : boîte de réception des retours, filtrable par type et statut, triable. Ni auteur ni e-mail.
// Texte brut (interpolation). Route réservée aux admins.
@Component({
  selector: 'app-admin-feedback-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
    <p class="back"><a routerLink="/admin">← Administration</a></p>
    <div class="page-head">
      <h1>Retours utilisateurs</h1>
      @if (list()?.length) {
        <!-- Compteurs de la liste affichée (déjà filtrée par le serveur), pas des totaux. -->
        <p class="muted counts">
          {{ list()!.length }} retour{{ plural(list()!.length) }} affiché{{ plural(list()!.length) }}, dont {{ untreated() }}
          nouveau{{ plural(untreated(), 'x') }}
        </p>
      }
    </div>
    <p class="muted intro">
      Suppression automatique {{ retention.afterTreatedDays }} jours après le traitement, {{ retention.untreatedDays }}
      jours après l'envoi sinon.
    </p>
    </header>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        <button type="button" class="link-button" (click)="error.set(''); reload()">Recharger</button>
      </p>
    }
    @if (expiring() > 0) {
      <p class="alert alert-warning" role="status">
        {{ expiring() }} retour(s) non traité(s) seront supprimés automatiquement d'ici {{ retention.warnDays }} jours.
      </p>
    }
    <div aria-live="polite">
      @if (status()) {
        <p class="alert alert-success confirm-pop">{{ status() }}</p>
      }
    </div>

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

    @if (list(); as all) {
      @if (all.length) {
        <ul class="card rows" aria-label="Retours">
          @for (f of all; track f.id) {
            <li class="row" [class.expiring]="f.expiringSoon" [class.confirm-pop]="f.id === treated() && f.status === 'TREATED'">
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
              <p class="row-foot muted">
                @if (f.expiringSoon) {
                  <span class="badge badge-neutral health health-warn">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="statusIcons.NEW" /></svg>
                    Bientôt supprimé</span
                  ><span class="visually-hidden"> : </span>
                }
                <span>Suppression le <time [attr.datetime]="f.expiresAt">{{ date(f.expiresAt) }}</time>.</span>
              </p>
              @if (f.status === 'NEW') {
                <div class="row-actions">
                  <button type="button" class="button button-secondary" [disabled]="marking() !== ''" (click)="treat(f)">
                    @if (marking() === f.id) {
                      Marquage en cours…
                    } @else {
                      Marquer comme traité<span class="visually-hidden"> ({{ typeLabel(f.type) }} du {{ dateTime(f.createdAt) }})</span>
                    }
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      } @else if (filtered()) {
        <p class="empty muted">Aucun retour ne correspond à ces filtres.</p>
      } @else {
        <p class="empty muted">Aucun retour.</p>
      }
    } @else if (!error()) {
      <p class="muted" role="status">Chargement…</p>
    }
  `,
  // Mise en page seulement : champs, bandeaux, pastilles et boutons viennent de la charte (styles.scss).
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
      max-width: 40rem;
    }
    // Lien retour, titre et durées de conservation forment un seul bloc.
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
    .filters {
      display: grid;
      gap: var(--space-3);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding-block: 0;
    }
    .row {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-4) 0 var(--space-4) var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
      p {
        margin: 0;
      }
    }
    // Bientôt supprimé : filet avertissement de 3 px à gauche (comme .unread-row), doublé de la pastille écrite.
    .expiring {
      box-shadow: inset 3px 0 0 var(--color-warning);
    }
    .row-head,
    .row-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
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
    .row-actions {
      margin-top: var(--space-2);
    }
    .empty {
      margin: 0;
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    @media (min-width: 768px) {
      .filters {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `,
})
export class AdminFeedbackPage {
  private readonly api = inject(ApiClient);

  protected readonly types = FEEDBACK_TYPES;
  protected readonly retention = FEEDBACK_RETENTION;
  protected readonly typeLabel = feedbackTypeLabel;
  protected readonly statusLabel = feedbackStatusLabel;
  protected readonly icons = TYPE_ICONS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly plural = s;
  protected readonly dateTime = (iso: string) => READABLE.format(new Date(iso));
  protected readonly date = (iso: string) => DATE.format(new Date(iso));

  // null tant que la liste n'est pas chargée (« Chargement… »).
  protected readonly list = signal<AdminFeedbackDto[] | null>(null);
  protected readonly expiring = computed(() => (this.list() ?? []).filter((f) => f.expiringSoon).length);
  protected readonly untreated = computed(() => (this.list() ?? []).filter((f) => f.status === 'NEW').length);
  protected readonly error = signal('');
  protected readonly status = signal('');
  /** Id en cours de marquage ('' sinon) ; tous les boutons sont désactivés pendant la requête. */
  protected readonly marking = signal('');
  /** Dernier retour marqué : sa ligne rejoue confirm-pop. */
  protected readonly treated = signal('');

  protected readonly filters = inject(NonNullableFormBuilder).group({
    type: '' as FeedbackType | '',
    status: '' as FeedbackStatus | '',
    sort: 'date' as AdminFeedbackSort,
  });
  // Lu au rendu, qui suit toujours le rechargement déclenché par un changement de filtre.
  protected readonly filtered = () => {
    const { type, status } = this.filters.getRawValue();
    return !!(type || status);
  };

  constructor() {
    this.filters.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    this.reload();
  }

  protected reload(): void {
    const { type, status, sort } = this.filters.getRawValue();
    this.api.get<AdminFeedbackDto[]>('/admin/feedback', { type: type || undefined, status: status || undefined, sort }).subscribe({
      next: (list) => this.list.set(list),
      error: (e) => this.error.set(errorMessage(e, { 403: 'Accès réservé aux administrateurs.' })),
    });
  }

  protected treat(f: AdminFeedbackDto): void {
    this.marking.set(f.id);
    this.api.post<AdminFeedbackDto>(`/admin/feedback/${f.id}/treat`).subscribe({
      next: () => {
        this.marking.set('');
        this.treated.set(f.id);
        this.error.set('');
        this.status.set('Retour marqué comme traité.');
        this.reload();
      },
      error: (e) => {
        this.marking.set('');
        this.error.set(errorMessage(e, { 404: 'Ce retour n’existe plus.' }));
      },
    });
  }
}
