import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { StorageUsageDto } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { initialsOf, Session } from '../../core/auth/session';
import { errorMessage } from '../auth/auth-form';

type ExportFormat = 'json' | 'csv';

/** Mot à saisir pour confirmer la suppression (action irréversible). */
export const DELETE_CONFIRMATION = 'SUPPRIMER';
/** Mot à saisir pour confirmer la réinitialisation ; l'accent est facultatif à la saisie. */
export const RESET_CONFIRMATION = 'RÉINITIALISER';

// Horodatages (instants UTC) affichés dans le fuseau du navigateur.
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_TIME = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const KO = new Intl.NumberFormat('fr-FR', { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 });
const MO = new Intl.NumberFormat('fr-FR', { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });
const MIB = 1024 * 1024;

/** Taille lisible : « 3 ko » sous 1 Mo, sinon « 1,2 Mo ». */
export const formatBytes = (n: number): string => (n < MIB ? KO.format(Math.ceil(n / 1024)) : MO.format(n / MIB));

const unaccented = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

// RGPD (SPEC §8) : export de toutes ses données, réinitialisation des données financières et suppression réelle du compte.
@Component({
  selector: 'app-my-account-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mon compte</h1>

    @if (session.user(); as user) {
      <section class="card profile" aria-label="Profil">
        <span class="profile-avatar" aria-hidden="true">{{ initials() }}</span>
        <div class="profile-text">
          <p class="profile-name">{{ user.name }} — {{ user.email }}</p>
          <dl class="facts">
            <div>
              <dt>Inscription<span class="visually-hidden"> :</span></dt>
              <dd>{{ day(user.createdAt) }}</dd>
            </div>
            <div>
              <dt>Dernière connexion<span class="visually-hidden"> :</span></dt>
              <dd>{{ user.lastConnection ? dayTime(user.lastConnection) : 'aucune' }}</dd>
            </div>
            <div class="storage">
              <dt>Pièces jointes<span class="visually-hidden"> :</span></dt>
              <dd>
                @if (storage(); as s) {
                  {{ size(s.usedBytes) }} utilisés sur {{ size(s.quotaBytes) }} ({{ storagePct() }} %)
                  <span class="gauge" aria-hidden="true"><span class="gauge-fill" [style.width.%]="storagePct()"></span></span>
                } @else if (storageError()) {
                  indisponible pour le moment ; rechargez la page pour réessayer.
                } @else {
                  <span role="status">Chargement…</span>
                }
              </dd>
            </div>
          </dl>
        </div>
      </section>
    }

    @if (error() && !dialog()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    @if (notice(); as n) {
      <p class="alert alert-success confirm-pop" role="status">{{ n }}</p>
    }

    <section class="card" aria-labelledby="h-vault">
      <h2 id="h-vault" class="card-title">Coffre-fort</h2>
      <p class="muted">Tous vos justificatifs et documents au même endroit : recherche, tri, tags, aperçu et téléchargement.</p>
      <div class="actions">
        <a class="button button-secondary" routerLink="/me/coffre">Ouvrir le coffre-fort</a>
      </div>
    </section>

    <section class="card" aria-labelledby="h-export">
      <h2 id="h-export" class="card-title">Exporter mes données</h2>
      <p class="muted">
        Toutes vos données : profil, comptes, transactions, virements, catégories, tags, récurrences, taux, scénarios et
        informations sur les pièces jointes et leurs tags. Le JSON est complet et réutilisable ; le CSV s'ouvre dans un tableur (une section par type de donnée).
      </p>
      <div class="actions">
        @for (format of formats; track format) {
          <button type="button" class="button button-secondary" [disabled]="busy()" (click)="download(format)">
            Exporter en {{ format.toUpperCase() }}
          </button>
        }
      </div>
      @if (exporting(); as format) {
        <p class="muted" role="status">Export {{ format.toUpperCase() }} en cours…</p>
      }
    </section>

    <section class="card danger" aria-labelledby="h-reset">
      <h2 id="h-reset" class="card-title danger-title">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>
        Réinitialiser mon compte
      </h2>
      <p>
        Efface <strong>définitivement</strong> vos comptes, transactions, virements, récurrences, taux, pièces jointes, scénarios et simulations.
        Vous restez connecté ; vos catégories, tags, retours et notifications sont gardés.
      </p>
      <div class="actions">
        <button type="button" class="button button-secondary" [disabled]="busy()" (click)="open('reset')">Réinitialiser mon compte…</button>
      </div>
    </section>

    <section class="card danger" aria-labelledby="h-delete">
      <h2 id="h-delete" class="card-title danger-title">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3zM12 10v5M12 18v.01" /></svg>
        Supprimer mon compte
      </h2>
      <p>
        La suppression est <strong>définitive</strong> : profil, comptes, transactions, pièces jointes et sessions sont effacés immédiatement.
        Les sauvegardes qui en contiennent une copie expirent sous 30 jours. Pensez à exporter vos données avant.
      </p>
      <div class="actions">
        <button type="button" class="button button-secondary" [disabled]="busy()" (click)="open('delete')">Supprimer mon compte…</button>
      </div>
    </section>

    <dialog #resetDialog class="modal" aria-labelledby="reset-dialog-title" (close)="closed()">
      <h2 id="reset-dialog-title" class="danger-title">Réinitialiser mon compte</h2>
      @if (error() && dialog() === 'reset') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <p>Comptes, transactions, virements, récurrences, taux, pièces jointes, scénarios et simulations seront effacés. Cette action ne s'annule pas.</p>
      <form class="form" [formGroup]="resetForm" (ngSubmit)="reset()">
        <div class="field">
          <label for="reset-confirm">Pour confirmer, saisissez {{ resetWord }}</label>
          <input id="reset-confirm" type="text" autocomplete="off" formControlName="confirm" aria-describedby="reset-confirm-hint" />
          <p id="reset-confirm-hint" class="field-hint">En majuscules ; l'accent est facultatif.</p>
        </div>
        @if (resetting()) {
          <p class="muted" role="status">Réinitialisation en cours…</p>
        }
        <div class="actions">
          <button type="submit" class="button button-danger" [disabled]="!resetConfirmed() || busy()">Réinitialiser mon compte</button>
          <button type="button" class="button button-secondary" (click)="resetDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>

    <dialog #deleteDialog class="modal" aria-labelledby="delete-dialog-title" (close)="closed()">
      <h2 id="delete-dialog-title" class="danger-title">Supprimer mon compte</h2>
      @if (error() && dialog() === 'delete') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <p>Votre compte et toutes ses données seront effacés. Cette action ne s'annule pas.</p>
      <form class="form" [formGroup]="form" (ngSubmit)="remove()">
        <div class="field">
          <label for="delete-confirm">Pour confirmer, saisissez {{ confirmation }}</label>
          <input id="delete-confirm" type="text" autocomplete="off" formControlName="confirm" aria-describedby="delete-confirm-hint" />
          <p id="delete-confirm-hint" class="field-hint">En majuscules, sans espace.</p>
        </div>
        @if (deleting()) {
          <p class="muted" role="status">Suppression en cours…</p>
        }
        <div class="actions">
          <button type="submit" class="button button-danger" [disabled]="!confirmed() || busy()">Supprimer définitivement mon compte</button>
          <button type="button" class="button button-secondary" (click)="deleteDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .card {
      max-width: 40rem;
      margin-bottom: var(--space-3);
    }
    .card > p {
      margin: 0 0 var(--space-3);
    }
    .profile {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .profile-avatar {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: var(--space-6);
      height: var(--space-6);
      border-radius: var(--radius-pill);
      background: var(--color-primary-soft);
      color: var(--color-primary);
      font-size: var(--text-lg);
      font-weight: var(--weight-bold);
    }
    .profile-text {
      min-width: 0;
      flex: 1;
    }
    .profile-name {
      margin: 0 0 var(--space-2);
      font-weight: var(--weight-bold);
      overflow-wrap: anywhere;
    }
    .facts {
      display: grid;
      gap: var(--space-1);
      margin: 0;
      font-size: var(--text-sm);
      div {
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--space-2);
      }
      dt {
        color: var(--color-text-muted);
      }
      dd {
        margin: 0;
      }
      .storage dd {
        flex-basis: 100%;
      }
      .gauge {
        display: block;
        max-width: 16rem;
        margin-top: var(--space-1);
      }
    }
    .modal p {
      margin-top: 0;
    }
    @media (min-width: 768px) {
      .facts .storage dd {
        flex-basis: auto;
      }
    }
  `,
})
export class MyAccountPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);
  private readonly resetDialog = viewChild.required<ElementRef<HTMLDialogElement>>('resetDialog');
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');

  protected readonly formats: ExportFormat[] = ['json', 'csv'];
  protected readonly confirmation = DELETE_CONFIRMATION;
  protected readonly resetWord = RESET_CONFIRMATION;
  protected readonly form = new FormGroup({ confirm: new FormControl('', { nonNullable: true }) });
  protected readonly resetForm = new FormGroup({ confirm: new FormControl('', { nonNullable: true }) });
  private readonly confirmValue = toSignal(this.form.controls.confirm.valueChanges, { initialValue: '' });
  private readonly resetValue = toSignal(this.resetForm.controls.confirm.valueChanges, { initialValue: '' });
  protected readonly confirmed = computed(() => this.confirmValue().trim() === DELETE_CONFIRMATION);
  protected readonly resetConfirmed = computed(() => unaccented(this.resetValue().trim()) === unaccented(RESET_CONFIRMATION));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly exporting = signal<ExportFormat | null>(null);
  protected readonly resetting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly dialog = signal<'reset' | 'delete' | null>(null);

  protected readonly initials = computed(() => initialsOf(this.session.user()));
  protected readonly storage = signal<StorageUsageDto | null>(null);
  protected readonly storageError = signal(false);
  protected readonly storagePct = computed(() => {
    const s = this.storage();
    return s && s.quotaBytes ? Math.min(100, Math.round((s.usedBytes / s.quotaBytes) * 100)) : 0;
  });
  protected readonly day = (iso: string) => DAY.format(new Date(iso));
  protected readonly dayTime = (iso: string) => DAY_TIME.format(new Date(iso));
  protected readonly size = formatBytes;

  constructor() {
    this.loadStorage();
  }

  private loadStorage(): void {
    this.api.get<StorageUsageDto>('/me/storage').subscribe({
      next: (s) => this.storage.set(s),
      error: () => this.storageError.set(true),
    });
  }

  protected open(which: 'reset' | 'delete'): void {
    this.error.set(null);
    this.notice.set(null);
    this.dialog.set(which);
    (which === 'reset' ? this.resetDialog() : this.deleteDialog()).nativeElement.showModal();
  }

  protected closed(): void {
    this.dialog.set(null);
    this.form.reset();
    this.resetForm.reset();
  }

  protected download(format: ExportFormat): void {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.exporting.set(format);
    this.api.download('/me/export', { format }).subscribe({
      next: (blob) => {
        this.busy.set(false);
        this.exporting.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budgetracker-export.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        this.notice.set(`Export ${format.toUpperCase()} téléchargé.`);
      },
      error: (err) => {
        this.busy.set(false);
        this.exporting.set(null);
        this.error.set(errorMessage(err));
      },
    });
  }

  protected reset(): void {
    if (!this.resetConfirmed()) return;
    this.busy.set(true);
    this.resetting.set(true);
    this.error.set(null);
    this.api.post<void>('/me/reset').subscribe({
      next: () => {
        this.busy.set(false);
        this.resetting.set(false);
        this.resetDialog().nativeElement.close();
        this.notice.set('Compte réinitialisé : comptes, transactions, récurrences, pièces jointes et simulations sont effacés.');
        this.loadStorage();
      },
      error: (err) => {
        this.busy.set(false);
        this.resetting.set(false);
        this.error.set(errorMessage(err, { 401: 'Session expirée : reconnectez-vous puis recommencez.' }));
      },
    });
  }

  protected remove(): void {
    if (!this.confirmed()) return;
    this.busy.set(true);
    this.deleting.set(true);
    this.error.set(null);
    this.session.deleteAccount().subscribe({
      next: () => {
        this.deleteDialog().nativeElement.close();
        this.router.navigateByUrl('/login');
      },
      error: (err) => {
        this.busy.set(false);
        this.deleting.set(false);
        this.error.set(errorMessage(err, { 401: 'Session expirée : reconnectez-vous puis recommencez.' }));
      },
    });
  }
}
