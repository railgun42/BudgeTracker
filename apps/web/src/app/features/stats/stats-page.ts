import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AccountDto, CategoryDto, CategoryStatDto, MonthlyStatDto, StatsQuery, StatTotals, TagDto, TagStatDto } from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { EurPipe } from '../../core/money';
import { today } from '../../core/today';
import { categoryLabel, NO_CATEGORY_LABEL } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

interface Row extends StatTotals {
  key: string;
  label: string;
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** 'YYYY-MM' → « janvier 2026 ». */
export const monthLabel = (month: string): string => MONTH.format(new Date(`${month}-01`));

// Statistiques (SPEC §6) : agrégats calculés par l'API ; barres en CSS, les montants restent lisibles en texte.
@Component({
  selector: 'app-stats-page',
  imports: [ReactiveFormsModule, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Statistiques</h1>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

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

    <p class="muted note">
      Les virements entre vos comptes sont exclus, de même que les soldes de départ. Un retrait d'espèces vers un portefeuille
      compte comme une dépense « Espèces » ; les achats saisis ensuite dans ce portefeuille s'y ajoutent (double comptage assumé).
    </p>

    @for (section of sections(); track section.id) {
      <section [attr.aria-labelledby]="'h-' + section.id">
        <h2 [id]="'h-' + section.id">{{ section.title }}</h2>
        @if (section.rows.length) {
          <table class="stats">
            <thead>
              <tr>
                <th scope="col">{{ section.head }}</th>
                <th scope="col" class="num">Revenus</th>
                <th scope="col" class="num">Dépenses</th>
              </tr>
            </thead>
            <tbody>
              @for (row of section.rows; track row.key) {
                <tr>
                  <th scope="row">
                    {{ row.label }}
                    <span class="bars" aria-hidden="true">
                      <span class="bar income" [style.width.%]="(row.incomeCents / section.max) * 100"></span>
                      <span class="bar expense" [style.width.%]="(row.expenseCents / section.max) * 100"></span>
                    </span>
                  </th>
                  <td class="num credit">{{ row.incomeCents | eur }}</td>
                  <td class="num debit">{{ row.expenseCents | eur }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else if (!loading()) {
          <p class="muted">Aucune donnée sur cette période.</p>
        }
      </section>
    }
  `,
  styles: `
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-2);
      align-items: end;
    }
    .note {
      margin: var(--space-3) 0;
    }
    section {
      margin-bottom: var(--space-4);
    }
    .stats {
      width: 100%;
      border-collapse: collapse;
      background: var(--color-surface);
    }
    .stats th,
    .stats td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
      vertical-align: top;
    }
    .stats .num {
      text-align: right;
      white-space: nowrap;
    }
    tbody th {
      font-weight: 400;
      width: 100%;
    }
    .bars {
      display: grid;
      gap: 2px;
      margin-top: var(--space-1);
    }
    .bar {
      display: block;
      height: 0.375rem;
      border-radius: 2px;
    }
    .income {
      background: var(--color-credit);
    }
    .expense {
      background: var(--color-debit);
    }
    .credit {
      color: var(--color-credit);
    }
    .debit {
      color: var(--color-debit);
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
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // Année civile en cours par défaut.
  private readonly year = today().slice(0, 4);
  protected readonly filters = this.fb.group({ from: `${this.year}-01-01`, to: `${this.year}-12-31`, accountId: '' });

  protected readonly sections = computed(() => {
    const categories = new Map(this.categories().map((c) => [c.id, c]));
    const tags = new Map(this.tags().map((t) => [t.id, t.name]));
    // Libellé « Parent › Enfant » ; null ⇒ « Sans catégorie » ; inconnue (ex. supprimée entre-temps) ⇒ libellé générique.
    const category = (id: string | null) => {
      if (!id) return NO_CATEGORY_LABEL;
      const c = categories.get(id);
      const parent = c?.parentId ? categories.get(c.parentId) : undefined;
      return !c ? 'Catégorie' : parent ? `${categoryLabel(parent)} › ${categoryLabel(c)}` : categoryLabel(c);
    };
    const section = (id: string, title: string, head: string, rows: Row[]) => ({
      id,
      title,
      head,
      rows,
      // Échelle commune aux deux barres de la section ; 1 évite la division par zéro.
      max: Math.max(1, ...rows.flatMap((r) => [r.incomeCents, r.expenseCents])),
    });
    return [
      section('monthly', 'Évolution mensuelle', 'Mois', this.monthly().map((m) => ({ ...m, key: m.month, label: monthLabel(m.month) }))),
      section('category', 'Par catégorie', 'Catégorie', this.byCategory().map((c) => ({ ...c, key: c.categoryId ?? '', label: category(c.categoryId) }))),
      section('tag', 'Par tag', 'Tag', this.byTag().map((t) => ({ ...t, key: t.tagId, label: tags.get(t.tagId) ?? 'Tag' }))),
    ];
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
  }

  protected load(): void {
    // Champs vides ⇒ undefined ⇒ absents de l'URL (ApiClient).
    const query: StatsQuery = Object.fromEntries(Object.entries(this.filters.getRawValue()).map(([k, v]) => [k, v || undefined]));
    this.loading.set(true);
    this.error.set(null);
    forkJoin([
      this.api.get<MonthlyStatDto[]>('/stats/monthly', { ...query }),
      this.api.get<CategoryStatDto[]>('/stats/by-category', { ...query }),
      this.api.get<TagStatDto[]>('/stats/by-tag', { ...query }),
    ]).subscribe({
      next: ([monthly, byCategory, byTag]) => {
        this.monthly.set(monthly);
        this.byCategory.set(byCategory);
        this.byTag.set(byTag);
        this.loading.set(false);
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
