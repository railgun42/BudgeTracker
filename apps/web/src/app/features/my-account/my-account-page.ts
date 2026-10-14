import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { Session } from '../../core/auth/session';
import { errorMessage } from '../auth/auth-form';

type ExportFormat = 'json' | 'csv';

/** Mot à saisir pour confirmer la suppression (action irréversible). */
export const DELETE_CONFIRMATION = 'SUPPRIMER';

// RGPD (SPEC §8) : export de toutes ses données et suppression réelle du compte.
@Component({
  selector: 'app-my-account-page',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mon compte</h1>
    @if (session.user(); as user) {
      <p>{{ user.name }} — {{ user.email }}</p>
    }

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <section aria-labelledby="h-export">
      <h2 id="h-export">Exporter mes données</h2>
      <p class="muted">
        Toutes vos données : profil, comptes, transactions, virements, catégories, tags, récurrences, taux, scénarios et
        informations sur les pièces jointes. Le JSON est complet et réutilisable ; le CSV s'ouvre dans un tableur (une section par type de donnée).
      </p>
      <div class="actions">
        @for (format of formats; track format) {
          <button type="button" class="button button-secondary" [disabled]="busy()" (click)="download(format)">
            Exporter en {{ format.toUpperCase() }}
          </button>
        }
      </div>
    </section>

    <section aria-labelledby="h-delete">
      <h2 id="h-delete">Supprimer mon compte</h2>
      <p>
        La suppression est <strong>définitive</strong> : profil, comptes, transactions, pièces jointes et sessions sont effacés immédiatement.
        Les sauvegardes qui en contiennent une copie expirent sous 30 jours. Pensez à exporter vos données avant.
      </p>
      <form class="form" [formGroup]="form" (ngSubmit)="remove()">
        <div class="field">
          <label for="delete-confirm">Pour confirmer, saisissez {{ confirmation }}</label>
          <input id="delete-confirm" type="text" autocomplete="off" formControlName="confirm" />
        </div>
        <button type="submit" class="button" [disabled]="!confirmed() || busy()">Supprimer définitivement mon compte</button>
      </form>
    </section>
  `,
  styles: `
    section {
      margin-bottom: var(--space-4);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class MyAccountPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);

  protected readonly formats: ExportFormat[] = ['json', 'csv'];
  protected readonly confirmation = DELETE_CONFIRMATION;
  protected readonly form = new FormGroup({ confirm: new FormControl('', { nonNullable: true }) });
  private readonly confirmValue = toSignal(this.form.controls.confirm.valueChanges, { initialValue: '' });
  protected readonly confirmed = computed(() => this.confirmValue().trim() === DELETE_CONFIRMATION);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected download(format: ExportFormat): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.download('/me/export', { format }).subscribe({
      next: (blob) => {
        this.busy.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budgetracker-export.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  protected remove(): void {
    if (!this.confirmed()) return;
    this.busy.set(true);
    this.error.set(null);
    this.session.deleteAccount().subscribe({
      next: () => this.router.navigateByUrl('/login'),
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, { 401: 'Session expirée : reconnectez-vous puis recommencez.' }));
      },
    });
  }
}
