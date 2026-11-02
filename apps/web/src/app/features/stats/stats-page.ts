import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  AccountDto,
  addDays,
  addMonths,
  CategoryDto,
  CategoryStatDto,
  lastDayOfMonth,
  MonthlyStatDto,
  StatsQuery,
  StatTotals,
  TagDto,
  TagStatDto,
} from '@budgetracker/shared';
import { debounceTime, forkJoin, of } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { SignedEurPipe } from '../../core/money';
import { today } from '../../core/today';
import { categoryIcon, NO_CATEGORY_ICON } from '../../shared-ui/category-icons';
import { categoryLabel, NO_CATEGORY_LABEL } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';
import { DonutChart, DonutPart } from './donut-chart';
import { MonthlyChart, monthLabel } from './monthly-chart';

export { monthLabel } from './monthly-chart';

interface Row extends StatTotals {
  key: string;
  label: string;
  /** Icône de la catégorie racine (ligne de racine, section « Par catégorie »). */
  icon?: string;
  /** Sous-ligne d'une racine : « Parent › » lu par les lecteurs d'écran, masqué à l'écran (retrait). */
  prefix?: string;
}

interface CategoryGroup extends StatTotals {
  /** Id de la racine ; '' = sans catégorie ; id inconnu (supprimée entre-temps) = son propre groupe. */
  key: string;
  label: string;
  icon: string;
  known: boolean;
  /** Lignes exactes (racine en direct + sous-catégories), seulement si la racine a des sous-catégories. */
  items: (StatTotals & { key: string; label: string })[];
}

/** Ordre de l'API : dépenses puis revenus décroissants. */
const byAmount = (a: StatTotals, b: StatTotals) => b.expenseCents - a.expenseCents || b.incomeCents - a.incomeCents;

type Period = 'month' | 'quarter' | 'year';

const FILTER_DELAY_MS = 300;
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));
const nextMonth = (month: string) => addMonths(`${month}-01`, 1).slice(0, 7);
const sum = (rows: StatTotals[]): StatTotals =>
  rows.reduce((t, r) => ({ incomeCents: t.incomeCents + r.incomeCents, expenseCents: t.expenseCents + r.expenseCents }), { incomeCents: 0, expenseCents: 0 });

/** Mois sans transaction (absents de l'API) comblés à zéro entre le premier et le dernier mois. */
export function fillMonths(rows: MonthlyStatDto[]): MonthlyStatDto[] {
  if (!rows.length) return rows;
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: MonthlyStatDto[] = [];
  for (let m = rows[0].month; m <= rows[rows.length - 1].month; m = nextMonth(m)) out.push(byMonth.get(m) ?? { month: m, incomeCents: 0, expenseCents: 0 });
  return out;
}

/** Période précédente de même durée : mêmes nombres de mois si la période couvre des mois entiers, sinon de jours. */
export function previousRange(from: string, to: string): { from: string; to: string } | null {
  if (from > to) return null;
  const end = addDays(from, -1);
  if (from.endsWith('-01') && to.slice(8) === lastDayOfMonth(to.slice(0, 7))) {
    const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
    return { from: addMonths(from, -months), to: end };
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  return { from: addDays(from, -days), to: end };
}

/** Périodes rapides, relatives à aujourd'hui. */
function periodRange(period: Period): { from: string; to: string } {
  const month = today().slice(0, 7);
  const end = `${month}-${lastDayOfMonth(month)}`;
  if (period === 'year') return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
  return { from: addMonths(`${month}-01`, period === 'month' ? 0 : -2), to: end };
}

// Statistiques (SPEC §6) : agrégats calculés par l'API ; chaque graphique a son tableau, les montants restent lisibles en texte.
@Component({
  selector: 'app-stats-page',
  imports: [ReactiveFormsModule, SignedEurPipe, MonthlyChart, DonutChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Statistiques</h1>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <div class="period">
      <span id="period-label" class="muted">Période</span>
      <div class="segmented" role="group" aria-labelledby="period-label">
        <button type="button" [attr.aria-pressed]="period() === 'month'" (click)="setPeriod('month')">Ce mois</button>
        <button type="button" [attr.aria-pressed]="period() === 'quarter'" (click)="setPeriod('quarter')">3 derniers mois</button>
        <button type="button" [attr.aria-pressed]="period() === 'year'" (click)="setPeriod('year')">Cette année</button>
      </div>
    </div>

    <!-- Repliable sur mobile ; toujours déplié dès 768 px (voir styles). -->
    <details class="filters-panel">
      <summary>Filtres</summary>
      <form class="filters" [formGroup]="filters" (ngSubmit)="load()" aria-label="Filtres">
        <div class="field">
          <label for="s-from">Du</label>
          <input id="s-from" type="date" formControlName="from" />
        </div>
        <div class="field">
          <label for="s-to">Au</label>
          <input id="s-to" type="date" formControlName="to" />
        </div>
        <div class="field">
          <label for="s-account">Compte</label>
          <select id="s-account" formControlName="accountId">
            <option value="">Tous les comptes</option>
            @for (a of accounts(); track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>
        </div>
        <div class="actions">
          <button class="button" type="submit" [disabled]="loading()">Afficher</button>
        </div>
      </form>
    </details>

    <p class="muted note">
      Les virements entre vos comptes sont exclus, de même que les soldes de départ. Un retrait d'espèces vers un portefeuille
      compte comme une dépense « Espèces » ; les achats saisis ensuite dans ce portefeuille s'y ajoutent (double comptage assumé).
    </p>

    @if (loading()) {
      <p class="muted" role="status">Chargement…</p>
    }

    @if (summary(); as s) {
      <section aria-labelledby="h-summary">
        <h2 id="h-summary" class="visually-hidden">Synthèse</h2>
        <ul class="stat-grid">
          @for (c of s.cards; track c.label) {
            <li class="card stat">
              <p class="stat-label">{{ c.label }}</p>
              <p class="stat-value amount" [class.credit]="c.cents > 0" [class.debit]="c.cents < 0">{{ c.cents | signedEur }}</p>
              @if (c.delta !== null) {
                <p class="stat-hint muted">{{ c.delta | signedEur }} par rapport à la période précédente</p>
              } @else if (c.hint) {
                <p class="stat-hint muted">{{ c.hint }}</p>
              }
            </li>
          }
        </ul>
        @if (previous(); as p) {
          <p class="muted compare">Période précédente : du {{ day(p.from) }} au {{ day(p.to) }}.</p>
        }
      </section>
    }

    @for (section of sections(); track section.id) {
      <section class="stats-section" [attr.aria-labelledby]="'h-' + section.id">
        <h2 [id]="'h-' + section.id">{{ section.title }}</h2>
        @if (section.rows.length) {
          @if (section.id === 'monthly') {
            <app-monthly-chart [rows]="months()" />
          }
          @if (section.id === 'category' && rootParts().length) {
            <app-donut-chart
              [parts]="rootParts()"
              title="Répartition des dépenses"
              description="Répartition des dépenses par catégorie ; valeurs détaillées dans le tableau ci-dessous"
            />
          }
          <div class="scroll">
            <table>
              <caption class="visually-hidden">{{ section.title }} : revenus, dépenses et solde</caption>
              <thead>
                <tr>
                  <th scope="col">{{ section.head }}</th>
                  <th scope="col" class="num">Revenus</th>
                  <th scope="col" class="num">Dépenses</th>
                  <th scope="col" class="num">Solde</th>
                </tr>
              </thead>
              <tbody>
                @for (row of section.rows; track row.key) {
                  <tr [class.sub]="row.prefix" [class.group]="row.icon">
                    <th scope="row">
                      <span class="row-label">
                        @if (row.icon) {
                          <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="row.icon" /></svg>
                        }
                        @if (row.prefix) {
                          <span class="visually-hidden">{{ row.prefix }}</span>
                        }
                        {{ row.label }}
                      </span>
                      <span class="bars" aria-hidden="true">
                        <span class="bar credit" [style.width.%]="(row.incomeCents / section.max) * 100"></span>
                        <span class="bar debit" [style.width.%]="(row.expenseCents / section.max) * 100"></span>
                      </span>
                    </th>
                    <td class="num amount" [class.credit]="row.incomeCents > 0">{{ row.incomeCents | signedEur }}</td>
                    <td class="num amount" [class.debit]="row.expenseCents > 0">{{ -row.expenseCents | signedEur }}</td>
                    <td class="num amount" [class.credit]="row.incomeCents > row.expenseCents" [class.debit]="row.incomeCents < row.expenseCents">
                      {{ row.incomeCents - row.expenseCents | signedEur }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (section.id === 'category' && detailOptions().length) {
            <div class="detail">
              <div class="field">
                <label for="s-detail">Détailler une catégorie</label>
                <select id="s-detail" [formControl]="detail">
                  <option value="">Aucune</option>
                  @for (g of detailOptions(); track g.key) {
                    <option [value]="g.key">{{ g.label }}</option>
                  }
                </select>
              </div>
              @if (detailGroup(); as g) {
                <h3>{{ g.label }}</h3>
                @if (subParts().length) {
                  <app-donut-chart
                    [parts]="subParts()"
                    title="Dépenses par sous-catégorie"
                    description="Dépenses par sous-catégorie ; valeurs détaillées dans le tableau ci-dessus"
                  />
                } @else {
                  <p class="muted">Aucune dépense par sous-catégorie sur cette période.</p>
                }
                @if (tagParts().length) {
                  <app-donut-chart [parts]="tagParts()" title="Dépenses par tag" description="Dépenses par tag ; valeurs détaillées dans le tableau ci-dessous">
                    <p class="muted tag-note">Une dépense à plusieurs tags compte pour chacun ; les dépenses sans tag n'y figurent pas.</p>
                  </app-donut-chart>
                  <div class="scroll">
                    <table>
                      <caption class="visually-hidden">Dépenses par tag : {{ g.label }}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Tag</th>
                          <th scope="col" class="num">Dépenses</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (t of tagParts(); track t.key) {
                          <tr>
                            <th scope="row">{{ t.label }}</th>
                            <td class="num amount debit">{{ -t.cents | signedEur }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else if (detailTags()) {
                  <p class="muted">Aucune dépense taguée dans cette catégorie sur cette période.</p>
                }
              }
            </div>
          }
        } @else if (!loading()) {
          <p class="empty muted">Aucune donnée sur cette période.</p>
        }
      </section>
    }
  `,
  // Mise en page seulement : champs, segmenté, cartes chiffrées, barres, tableaux, montants et icônes viennent de la charte.
  styles: `
    .period {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-2);
      font-size: var(--text-sm);
      .segmented {
        flex: 1 1 18rem;
        max-width: 26rem;
      }
    }
    .filters-panel {
      margin-bottom: var(--space-2);
      > summary {
        display: flex;
        align-items: center;
        min-height: var(--tap);
        color: var(--color-primary);
        font-weight: var(--weight-medium);
        cursor: pointer;
      }
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
      gap: var(--space-3);
      align-items: end;
      padding-top: var(--space-2);
      .actions {
        grid-column: 1 / -1;
      }
    }
    // Bureau : filtres toujours visibles (navigateurs qui exposent ::details-content ; sinon le repli reste).
    @media (min-width: 768px) {
      @supports selector(::details-content) {
        .filters-panel > summary {
          display: none;
        }
        .filters-panel::details-content {
          content-visibility: visible;
          block-size: auto;
        }
      }
    }
    .note {
      margin: var(--space-3) 0;
      font-size: var(--text-sm);
    }
    .compare {
      margin: calc(-1 * var(--space-2)) 0 var(--space-4);
      font-size: var(--text-sm);
    }
    .stats-section {
      margin-bottom: var(--space-5);
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      h2 {
        margin: 0 0 var(--space-3);
        font-size: var(--text-lg);
      }
      table {
        min-width: 22rem;
      }
    }
    tbody th {
      font-weight: var(--weight-regular);
      width: 100%;
    }
    .row-label {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    tr.group th {
      font-weight: var(--weight-medium);
    }
    /* Sous-catégorie alignée sur le nom de la racine (après l'icône de 32 px). */
    tr.sub th {
      padding-left: calc(var(--space-3) + var(--space-5) + var(--space-2));
      color: var(--color-text-muted);
    }
    .detail {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--color-border);
      .field {
        max-width: 22rem;
        margin-bottom: var(--space-3);
      }
      h3 {
        margin: 0 0 var(--space-2);
      }
    }
    .tag-note {
      margin: var(--space-2) 0 0;
      font-size: var(--text-xs);
    }
    .empty {
      margin: 0;
      padding: var(--space-4) var(--space-3);
      text-align: center;
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
    }
  `,
})
export class StatsPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly categories = signal<CategoryDto[]>([]);
  private readonly tags = signal<TagDto[]>([]);
  private readonly monthly = signal<MonthlyStatDto[]>([]);
  private readonly byCategory = signal<CategoryStatDto[]>([]);
  private readonly byTag = signal<TagStatDto[]>([]);
  /** Totaux de la période précédente de même durée (null si Du ou Au est vide). */
  protected readonly previous = signal<{ from: string; to: string; totals: StatTotals } | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly day = dayLabel;

  // Année civile en cours par défaut.
  protected readonly filters = this.fb.group({ ...periodRange('year'), accountId: '' });
  private readonly value = toSignal(this.filters.valueChanges, { initialValue: this.filters.getRawValue() });
  private applied: StatsQuery = {};

  /** Période rapide correspondant aux dates saisies (aucune si dates personnalisées). */
  protected readonly period = computed(() => {
    const { from, to } = this.value();
    return (['month', 'quarter', 'year'] as const).find((p) => {
      const r = periodRange(p);
      return r.from === from && r.to === to;
    });
  });

  protected readonly months = computed(() => fillMonths(this.monthly()));
  /** Catégorie racine détaillée (sous-catégories et tags) ; hors filtres : ne recharge que les tags. */
  protected readonly detail = new FormControl('', { nonNullable: true });
  private readonly detailValue = toSignal(this.detail.valueChanges, { initialValue: '' });
  /** Dépenses par tag de la catégorie détaillée (null tant qu'aucune n'est choisie). */
  protected readonly detailTags = signal<TagStatDto[] | null>(null);

  /** « Par catégorie » regroupé par racine : une racine additionne ses sous-catégories. */
  private readonly categoryGroups = computed(() => {
    const categories = new Map(this.categories().map((c) => [c.id, c]));
    const groups = new Map<string, CategoryGroup>();
    for (const row of this.byCategory()) {
      const c = row.categoryId ? categories.get(row.categoryId) : undefined;
      const root = c?.parentId ? categories.get(c.parentId) : c;
      const key = root?.id ?? row.categoryId ?? '';
      const label = root ? categoryLabel(root) : row.categoryId ? 'Catégorie' : NO_CATEGORY_LABEL;
      const g = groups.get(key) ?? { key, label, icon: root ? categoryIcon(root) : NO_CATEGORY_ICON, known: !!root, incomeCents: 0, expenseCents: 0, items: [] };
      g.incomeCents += row.incomeCents;
      g.expenseCents += row.expenseCents;
      g.items.push({ ...row, key: row.categoryId ?? '', label: c && c !== root ? categoryLabel(c) : 'Sans sous-catégorie' });
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, items: g.items.some((i) => i.key !== g.key) ? g.items.sort(byAmount) : [] }))
      .sort(byAmount);
  });

  protected readonly rootParts = computed<DonutPart[]>(() =>
    this.categoryGroups()
      .filter((g) => g.expenseCents > 0)
      .map((g) => ({ key: g.key, label: g.label, cents: g.expenseCents })),
  );

  protected readonly detailOptions = computed(() => this.categoryGroups().filter((g) => g.known));
  protected readonly detailGroup = computed(() => this.detailOptions().find((g) => g.key === this.detailValue()));
  protected readonly subParts = computed<DonutPart[]>(() =>
    (this.detailGroup()?.items ?? []).filter((i) => i.expenseCents > 0).map((i) => ({ key: i.key, label: i.label, cents: i.expenseCents })),
  );
  protected readonly tagParts = computed<DonutPart[]>(() => {
    const names = new Map(this.tags().map((t) => [t.id, t.name]));
    return (this.detailTags() ?? [])
      .filter((t) => t.expenseCents > 0)
      .sort(byAmount)
      .map((t) => ({ key: t.tagId, label: names.get(t.tagId) ?? 'Tag', cents: t.expenseCents }));
  });

  protected readonly sections = computed(() => {
    const tags = new Map(this.tags().map((t) => [t.id, t.name]));
    const section = (id: string, title: string, head: string, rows: Row[]) => ({
      id,
      title,
      head,
      rows,
      // Échelle commune aux deux barres de la section ; 1 évite la division par zéro.
      max: Math.max(1, ...rows.flatMap((r) => [r.incomeCents, r.expenseCents])),
    });
    return [
      section('monthly', 'Évolution mensuelle', 'Mois', this.months().map((m) => ({ ...m, key: m.month, label: monthLabel(m.month) }))),
      section(
        'category',
        'Par catégorie',
        'Catégorie',
        // Racine (total, icône) puis, si elle a des sous-catégories, ses lignes exactes : lues « Parent › Enfant ».
        this.categoryGroups().flatMap((g) => [
          { ...g, key: `g${g.key}` },
          ...g.items.map((i) => ({ ...i, key: `i${i.key}`, prefix: `${g.label} › ` })),
        ]),
      ),
      section('tag', 'Par tag', 'Tag', this.byTag().map((t) => ({ ...t, key: t.tagId, label: tags.get(t.tagId) ?? 'Tag' }))),
    ];
  });

  /** Cartes de synthèse, tirées de l'évolution mensuelle ; écart avec la période précédente si elle est connue. */
  protected readonly summary = computed(() => {
    const months = this.months();
    if (!months.length) return null;
    const t = sum(months);
    const p = this.previous()?.totals;
    const delta = (now: number, before?: number) => (before === undefined ? null : now - before);
    return {
      cards: [
        { label: 'Revenus', cents: t.incomeCents, delta: delta(t.incomeCents, p?.incomeCents), hint: '' },
        { label: 'Dépenses', cents: -t.expenseCents, delta: delta(-t.expenseCents, p && -p.expenseCents), hint: '' },
        {
          label: 'Solde net',
          cents: t.incomeCents - t.expenseCents,
          delta: delta(t.incomeCents - t.expenseCents, p && p.incomeCents - p.expenseCents),
          hint: '',
        },
        {
          label: 'Dépenses par mois',
          cents: -Math.round(t.expenseCents / months.length),
          delta: null,
          hint: `Moyenne sur ${months.length} mois`,
        },
      ],
    };
  });

  constructor() {
    forkJoin([
      this.api.get<AccountDto[]>('/accounts'),
      this.api.get<CategoryDto[]>('/categories'),
      this.api.get<TagDto[]>('/tags'),
    ]).subscribe({
      next: ([accounts, categories, tags]) => {
        this.accounts.set(accounts);
        this.categories.set(categories);
        this.tags.set(tags);
      },
      error: (e) => this.fail(e),
    });
    this.load();
    // Filtres appliqués dès qu'ils changent ; le délai évite une requête par chiffre tapé dans une date.
    this.filters.valueChanges.pipe(debounceTime(FILTER_DELAY_MS), takeUntilDestroyed()).subscribe(() => {
      if (JSON.stringify(this.query()) !== JSON.stringify(this.applied)) this.load();
    });
    this.detail.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.loadDetailTags());
  }

  /** Tags de la catégorie détaillée, avec les filtres appliqués (l'API inclut ses sous-catégories). */
  private loadDetailTags(): void {
    const categoryId = this.detail.value;
    this.detailTags.set(null);
    if (!categoryId) return;
    this.api.get<TagStatDto[]>('/stats/by-tag', { ...this.applied, categoryId }).subscribe({
      next: (rows) => this.detailTags.set(rows),
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette catégorie n’existe plus. Rechargez la page.' })),
    });
  }

  protected setPeriod(period: Period): void {
    this.filters.patchValue(periodRange(period));
    this.load();
  }

  /** Champs vides ⇒ undefined ⇒ absents de l'URL (ApiClient). */
  private query(): StatsQuery {
    return Object.fromEntries(Object.entries(this.filters.getRawValue()).map(([k, v]) => [k, v || undefined]));
  }

  protected load(): void {
    const query = (this.applied = this.query());
    const range = query.from && query.to ? previousRange(query.from, query.to) : null;
    this.loading.set(true);
    this.error.set(null);
    forkJoin([
      this.api.get<MonthlyStatDto[]>('/stats/monthly', { ...query }),
      this.api.get<CategoryStatDto[]>('/stats/by-category', { ...query }),
      this.api.get<TagStatDto[]>('/stats/by-tag', { ...query }),
      range ? this.api.get<MonthlyStatDto[]>('/stats/monthly', { ...query, ...range }) : of(null),
    ]).subscribe({
      next: ([monthly, byCategory, byTag, previous]) => {
        this.monthly.set(monthly);
        this.byCategory.set(byCategory);
        this.byTag.set(byTag);
        this.previous.set(range && previous ? { ...range, totals: sum(previous) } : null);
        this.loading.set(false);
        this.loadDetailTags();
      },
      error: (e) => {
        this.loading.set(false);
        this.fail(e);
      },
    });
  }

  private fail(e: unknown): void {
    this.error.set(errorMessage(e, { 400: 'Période invalide.', 404: 'Ce compte n’existe plus. Rechargez la page.' }));
  }
}
