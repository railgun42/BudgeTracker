import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminStatsDto } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';
import { NOTIFICATION_ICONS } from '../notifications/notifications';

const NUMBER = new Intl.NumberFormat('fr-FR');
const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
// Affichage seulement : « 15 oct. 2026, 10:00 » dans le fuseau du navigateur.
const READABLE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const TIME = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });

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

// Pastilles de santé écrites (texte + icône, la couleur ne fait que doubler). Rouge réservé à l'échec et aux erreurs.
interface Health {
  cls: string;
  label: string;
  icon: string;
}
const CHECK = 'M5 12l5 5 9-10';
const CLOCK = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z';
const OK: Health = { cls: 'health-ok', label: 'OK', icon: CHECK };
const SLOW: Health = { cls: 'health-warn', label: 'Lente', icon: CLOCK };
const TO_CHECK: Health = { cls: 'health-error', label: 'À examiner', icon: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01' };
const DONE: Health = { cls: 'health-ok', label: 'Réussie', icon: CHECK };
const FAILED: Health = { cls: 'health-error', label: 'En échec', icon: 'M6 6l12 12M18 6 6 18' };
const PENDING: Health = { cls: '', label: 'En attente', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 12h8' };
// Seuil d'affichage fixé côté front (aucun SLA défini) : au-delà, la latence de la base est « Lente ».
const SLOW_DB_MS = 200;

interface Stat {
  label: string;
  value: string;
  hint?: string;
}
interface ApiRow extends Stat {
  at?: string;
  health?: Health;
}

const LINKS = [
  { path: '/admin/categories', label: 'Catégories globales', hint: 'Créer, renommer et archiver les catégories proposées à tous.', icon: 'M3.5 12.5V4h8.5l8.5 8.5-8 8zM8 8.5h.01' },
  { path: '/admin/feedback', label: 'Retours utilisateurs', hint: 'Lire les avis et les marquer comme traités.', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' },
  { path: '/admin/notifications', label: 'Notifications et annonces', hint: 'Envoyer une annonce à tous ou un message à un utilisateur.', icon: NOTIFICATION_ICONS.ANNOUNCEMENT },
  { path: '/admin/suggestions', label: 'Suggestions de catégorie', hint: 'Accepter, refuser ou traiter les propositions.', icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
];

// Administration (SPEC §13.2) : agrégats seulement, jamais de donnée d'un utilisateur. Route réservée aux admins.
@Component({
  selector: 'app-admin-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <h1>Administration</h1>
      <div class="refresh">
        <p class="muted" role="status">
          @if (loading()) {
            {{ stats() ? 'Actualisation…' : 'Chargement…' }}
          } @else if (updatedAt(); as at) {
            Mis à jour à <time [attr.datetime]="at.toISOString()">{{ time(at) }}</time>
          }
        </p>
        <button type="button" class="button button-secondary" [disabled]="loading()" (click)="load()">
          {{ loading() && stats() ? 'Actualisation…' : 'Actualiser' }}
        </button>
      </div>
    </div>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        <button type="button" class="link-button" [disabled]="loading()" (click)="load()">Recharger</button>
      </p>
    }

    <nav aria-label="Administration">
      <ul class="links">
        @for (link of links; track link.path) {
          <li class="card link-card">
            <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="link.icon" /></svg>
            <div>
              <a [routerLink]="link.path" [attr.aria-describedby]="'admin-link-' + $index">{{ link.label }}</a>
              <p class="muted" [id]="'admin-link-' + $index">{{ link.hint }}</p>
            </div>
          </li>
        }
      </ul>
    </nav>

    <!-- Bloc recréé à chaque réponse : confirm-pop rejoue après une actualisation réussie. -->
    @for (n of [loads()]; track n) {
      @if (stats(); as s) {
        <div [attr.aria-busy]="loading()">
          <section aria-labelledby="h-users">
            <h2 id="h-users">Utilisateurs</h2>
            <dl class="stat-grid">
              @for (stat of users(); track stat.label) {
                <div class="card stat" [class.confirm-pop]="n > 1">
                  <dt class="stat-label">{{ stat.label }}</dt>
                  <dd class="stat-value">{{ stat.value }}</dd>
                  @if (stat.hint) {
                    <dd class="stat-hint muted">{{ stat.hint }}</dd>
                  }
                </div>
              }
            </dl>
          </section>

          <section aria-labelledby="h-volumes">
            <h2 id="h-volumes">Volumes</h2>
            <dl class="stat-grid">
              @for (stat of volumes(); track stat.label) {
                <div class="card stat" [class.confirm-pop]="n > 1">
                  <dt class="stat-label">{{ stat.label }}</dt>
                  <dd class="stat-value">{{ stat.value }}</dd>
                  @if (stat.hint) {
                    <dd class="stat-hint muted">{{ stat.hint }}</dd>
                  }
                </div>
              }
            </dl>
          </section>

          <section aria-labelledby="h-api">
            <h2 id="h-api">État de l'API</h2>
            <div class="card" [class.confirm-pop]="n > 1">
              <dl class="api">
                @for (row of apiRows(); track row.label) {
                  <div class="api-row">
                    <dt>{{ row.label }}</dt>
                    <dd>
                      @if (row.at) {
                        <time [attr.datetime]="row.at">{{ row.value }}</time>
                      } @else {
                        {{ row.value }}
                      }
                      @if (row.hint) {
                        <span class="muted">{{ row.hint }}</span>
                      }
                    </dd>
                    @if (row.health; as h) {
                      <dd>
                        <span class="badge badge-neutral health" [class]="h.cls">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="h.icon" /></svg>
                          {{ h.label }}
                        </span>
                      </dd>
                    }
                  </div>
                }
              </dl>
              <p class="muted note">Compteurs en mémoire, remis à zéro à chaque redémarrage de l'API.</p>
            </div>
          </section>
        </div>
      }
    }
  `,
  styles: `
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-3);
    }
    h1,
    .refresh p {
      margin: 0;
    }
    .refresh {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
    }
    .refresh p {
      font-size: var(--text-sm);
    }
    .links {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
      gap: var(--space-2);
      padding: 0;
      margin: 0 0 var(--space-4);
      list-style: none;
    }
    /* Carte entièrement cliquable : le lien s'étend sur la carte, son nom accessible reste le titre. */
    .link-card {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      min-height: var(--tap);
      padding: var(--space-3);
      transition: background var(--duration-fast) var(--ease-out);
    }
    .link-card:hover {
      background: var(--color-surface-2);
    }
    .link-card:has(a:focus-visible) {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
    .link-card a {
      font-weight: var(--weight-bold);
      text-decoration: none;
    }
    .link-card a:focus-visible {
      outline: none;
    }
    .link-card a::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: var(--radius);
    }
    .link-card p {
      margin: var(--space-1) 0 0;
      font-size: var(--text-sm);
    }
    section {
      margin-top: var(--space-4);
    }
    h2 {
      margin-bottom: var(--space-2);
    }
    .api {
      margin: 0;
    }
    .api-row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: var(--space-1) var(--space-3);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--color-border);
      font-variant-numeric: tabular-nums;
    }
    .api-row dt {
      grid-column: 1 / -1;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    .api-row dd {
      margin: 0;
      font-weight: var(--weight-medium);
    }
    .api-row dd .muted {
      font-weight: var(--weight-regular);
    }
    .note {
      margin: var(--space-2) 0 0;
      font-size: var(--text-sm);
    }
    @media (min-width: 48rem) {
      .api-row {
        grid-template-columns: minmax(12rem, 2fr) 3fr auto;
      }
      .api-row dt {
        grid-column: auto;
        font-size: var(--text-base);
        color: var(--color-text);
      }
    }
  `,
})
export class AdminPage {
  private readonly api = inject(ApiClient);

  protected readonly stats = signal<AdminStatsDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  /** Réponses reçues : au-delà de la première, les blocs rejouent confirm-pop. */
  protected readonly loads = signal(0);
  protected readonly updatedAt = signal<Date | null>(null);
  protected readonly links = LINKS;
  protected readonly time = (d: Date) => TIME.format(d);

  protected readonly users = computed<Stat[]>(() => {
    const u = this.stats()?.users;
    if (!u) return [];
    const share = (n: number, suffix: string) => (u.total ? `${PERCENT.format(n / u.total)} ${suffix}` : undefined);
    return [
      { label: 'Total', value: NUMBER.format(u.total) },
      { label: 'E-mail vérifié', value: NUMBER.format(u.verified), hint: share(u.verified, 'des inscrits') },
      { label: 'Nouveaux (7 j / 30 j)', value: `${NUMBER.format(u.new7d)} / ${NUMBER.format(u.new30d)}` },
      { label: 'Actifs (7 j / 30 j)', value: `${NUMBER.format(u.active7d)} / ${NUMBER.format(u.active30d)}`, hint: share(u.active30d, 'actifs sur 30 j') },
    ];
  });

  protected readonly volumes = computed<Stat[]>(() => {
    const s = this.stats();
    if (!s) return [];
    const v = s.volumes;
    return [
      { label: 'Comptes', value: NUMBER.format(v.accounts) },
      { label: 'Transactions', value: NUMBER.format(v.transactions) },
      { label: 'Récurrences', value: NUMBER.format(v.recurrences) },
      { label: 'Pièces jointes', value: NUMBER.format(v.attachments), hint: `${formatBytes(v.storageBytes)} stockés` },
      { label: 'Taille de la base', value: formatBytes(s.database.sizeBytes) },
    ];
  });

  protected readonly apiRows = computed<ApiRow[]>(() => {
    const s = this.stats();
    if (!s) return [];
    return [
      { label: 'En service depuis', value: formatDuration(s.api.uptimeSeconds), hint: `(depuis le ${READABLE.format(new Date(s.api.startedAt))})` },
      { label: 'Latence de la base', value: `${NUMBER.format(s.database.latencyMs)} ms`, health: s.database.latencyMs < SLOW_DB_MS ? OK : SLOW },
      { label: 'Mémoire', value: formatBytes(s.api.memoryRssBytes) },
      { label: 'Erreurs serveur depuis le démarrage', value: NUMBER.format(s.api.errorsSinceStart), health: s.api.errorsSinceStart ? TO_CHECK : OK },
      ...JOBS.map(({ key, label }): ApiRow => {
        const run = s.api.jobs[key];
        return run
          ? { label, value: READABLE.format(new Date(run.at)), at: run.at, health: run.ok ? DONE : FAILED }
          : { label, value: 'pas encore exécutée depuis le démarrage', health: PENDING };
      }),
    ];
  });

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
        this.updatedAt.set(new Date());
        this.loads.update((n) => n + 1);
      },
      error: (err) => {
        this.error.set(errorMessage(err, { 403: 'Accès réservé aux administrateurs.' }));
        this.loading.set(false);
      },
    });
  }
}
