import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminStatsDto, JobRunDto } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';

const NUMBER = new Intl.NumberFormat('fr-FR');
const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** 1536 → « 1,5 Ko » (puissances de 1024). */
export function formatBytes(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) [bytes, i] = [bytes / 1024, i + 1];
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes)} ${units[i]}`;
}

/** 93784 → « 1 j 2 h 3 min ». */
export function formatDuration(seconds: number): string {
  const [d, h, m] = [Math.floor(seconds / 86_400), Math.floor((seconds % 86_400) / 3600), Math.floor((seconds % 3600) / 60)];
  return [d && `${d} j`, (d || h) && `${h} h`, `${m} min`].filter(Boolean).join(' ');
}

const JOBS: { key: keyof AdminStatsDto['api']['jobs']; label: string }[] = [
  { key: 'recurrences', label: 'Génération des récurrences' },
  { key: 'interest', label: 'Crédit des intérêts' },
  { key: 'purge', label: 'Purge des suppressions' },
];

// Administration (SPEC §13.2) : agrégats seulement, jamais de donnée d'un utilisateur. Route réservée aux admins.
@Component({
  selector: 'app-admin-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Administration</h1>
    <nav aria-label="Administration">
      <a routerLink="/admin/categories">Catégories globales</a>
      <a routerLink="/admin/feedback">Retours utilisateurs</a>
      <a routerLink="/admin/notifications">Notifications et annonces</a>
      <a routerLink="/admin/suggestions">Suggestions de catégorie</a>
    </nav>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <button type="button" class="button button-secondary" [disabled]="loading()" (click)="load()">Actualiser</button>

    @if (stats(); as s) {
      <section aria-labelledby="h-users">
        <h2 id="h-users">Utilisateurs</h2>
        <dl>
          <dt>Total</dt><dd>{{ n(s.users.total) }}</dd>
          <dt>E-mail vérifié</dt><dd>{{ n(s.users.verified) }}</dd>
          <dt>Nouveaux (7 j / 30 j)</dt><dd>{{ n(s.users.new7d) }} / {{ n(s.users.new30d) }}</dd>
          <dt>Actifs (7 j / 30 j)</dt><dd>{{ n(s.users.active7d) }} / {{ n(s.users.active30d) }}</dd>
        </dl>
      </section>

      <section aria-labelledby="h-volumes">
        <h2 id="h-volumes">Volumes</h2>
        <dl>
          <dt>Comptes</dt><dd>{{ n(s.volumes.accounts) }}</dd>
          <dt>Transactions</dt><dd>{{ n(s.volumes.transactions) }}</dd>
          <dt>Récurrences</dt><dd>{{ n(s.volumes.recurrences) }}</dd>
          <dt>Pièces jointes</dt><dd>{{ n(s.volumes.attachments) }} ({{ bytes(s.volumes.storageBytes) }})</dd>
          <dt>Taille de la base</dt><dd>{{ bytes(s.database.sizeBytes) }}</dd>
        </dl>
      </section>

      <section aria-labelledby="h-api">
        <h2 id="h-api">État de l'API</h2>
        <dl>
          <dt>En service depuis</dt><dd>{{ duration(s.api.uptimeSeconds) }} ({{ dateTime(s.api.startedAt) }})</dd>
          <dt>Latence de la base</dt><dd>{{ s.database.latencyMs }} ms</dd>
          <dt>Mémoire</dt><dd>{{ bytes(s.api.memoryRssBytes) }}</dd>
          <dt>Erreurs serveur depuis le démarrage</dt><dd>{{ n(s.api.errorsSinceStart) }}</dd>
          @for (job of jobs; track job.key) {
            <dt>{{ job.label }}</dt><dd>{{ jobRun(s.api.jobs[job.key]) }}</dd>
          }
        </dl>
        <p class="muted">Compteurs en mémoire, remis à zéro à chaque redémarrage de l'API.</p>
      </section>
    }
  `,
  styles: `
    section {
      margin-top: var(--space-4);
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-1) var(--space-3);
    }
    dd {
      margin: 0;
    }
  `,
})
export class AdminPage {
  private readonly api = inject(ApiClient);

  protected readonly stats = signal<AdminStatsDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly jobs = JOBS;
  protected readonly n = (value: number) => NUMBER.format(value);
  protected readonly bytes = formatBytes;
  protected readonly duration = formatDuration;
  protected readonly dateTime = (iso: string) => DATE_TIME.format(new Date(iso));
  protected readonly jobRun = (run: JobRunDto | null) =>
    run ? `${DATE_TIME.format(new Date(run.at))} — ${run.ok ? 'réussie' : 'en échec'}` : 'pas encore exécutée depuis le démarrage';

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.get<AdminStatsDto>('/admin/stats').subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, { 403: 'Accès réservé aux administrateurs.' }));
        this.loading.set(false);
      },
    });
  }
}
