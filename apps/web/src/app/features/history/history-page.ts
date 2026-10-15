import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AccountDto,
  AttachmentDto,
  CategoryDto,
  centsToEuros,
  eurosToCents,
  TagDto,
  TransactionDto,
  TransactionListQuery,
  TransactionPage,
  TransactionType,
  UNCATEGORIZED,
  UpdateTransactionInput,
} from '@budgetracker/shared';
import { debounceTime, forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, SignedEurPipe } from '../../core/money';
import { categoryIcon, NO_CATEGORY_ICON } from '../../shared-ui/category-icons';
import { categoryLabel, NO_CATEGORY_LABEL } from '../../shared-ui/labels';
import { UndoBanner } from '../../shared-ui/undo-banner';
import { errorMessage } from '../auth/auth-form';
import { AttachmentControl } from '../transactions/attachment-control';

type GroupBy = 'day' | 'week' | 'month';

export const FILTER_DELAY_MS = 300;

// Affichage seulement : les dates restent 'YYYY-MM-DD' ; lues en UTC pour ne jamais changer de jour.
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const dayLabel = (date: string) => DAY.format(utc(date));

/** Lundi de la semaine du jour donné. */
function monday(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Historique paginé par curseur (50 par page côté API, « Charger plus »), filtres date/catégorie/tag/compte (SPEC §7).
@Component({
  selector: 'app-history-page',
  imports: [ReactiveFormsModule, RouterLink, SignedEurPipe, UndoBanner, AttachmentControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Historique des transactions</h1>

    @if (undoable(); as deleted) {
      <app-undo-banner [message]="'Transaction « ' + label(deleted) + ' » supprimée.'" (undo)="restore(deleted)" />
    }
    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        @if (conflict()) {
          <button type="button" class="link-button" (click)="reload()">Recharger</button>
        }
      </p>
    }

    <!-- Repliable sur mobile ; toujours déplié dès 768 px (voir styles). -->
    <details class="filters-panel">
      <summary>Filtres</summary>
      <form class="filters" [formGroup]="filters" (ngSubmit)="search()" aria-label="Filtres">
        <div class="field">
          <label for="f-from">Du</label>
          <input id="f-from" type="date" formControlName="from" />
        </div>
        <div class="field">
          <label for="f-to">Au</label>
          <input id="f-to" type="date" formControlName="to" />
        </div>
        <div class="field">
          <label for="f-account">Compte</label>
          <select id="f-account" formControlName="accountId">
            <option value="">Tous les comptes</option>
            @for (a of accounts(); track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="f-category">Catégorie</label>
          <select id="f-category" formControlName="categoryId">
            <option value="">Toutes les catégories</option>
            <option [value]="UNCATEGORIZED">{{ NO_CATEGORY_LABEL }}</option>
            @for (c of parentOptions(); track c.id) {
              <option [value]="c.id">{{ c.label }}</option>
            }
          </select>
        </div>
        @if (subOptions().length) {
          <div class="field">
            <label for="f-subcategory">Sous-catégorie</label>
            <select id="f-subcategory" formControlName="subcategoryId">
              <option value="">Toutes les sous-catégories</option>
              @for (c of subOptions(); track c.id) {
                <option [value]="c.id">{{ c.label }}</option>
              }
            </select>
          </div>
        }
        <div class="field">
          <label for="f-tag">Tag</label>
          <select id="f-tag" formControlName="tagId">
            <option value="">Tous les tags</option>
            @for (t of tags(); track t.id) {
              <option [value]="t.id">{{ t.name }}</option>
            }
          </select>
        </div>
        <div class="actions">
          <button class="button button-secondary" type="button" (click)="clearFilters()">Effacer les filtres</button>
        </div>
      </form>
    </details>

    <div class="list-head">
      <span id="group-by-label" class="muted">Regrouper par</span>
      <div class="segmented" role="group" aria-labelledby="group-by-label">
        <button type="button" [attr.aria-pressed]="groupBy() === 'day'" (click)="groupBy.set('day')">Jour</button>
        <button type="button" [attr.aria-pressed]="groupBy() === 'week'" (click)="groupBy.set('week')">Semaine</button>
        <button type="button" [attr.aria-pressed]="groupBy() === 'month'" (click)="groupBy.set('month')">Mois</button>
      </div>
    </div>

    <ul class="rows" aria-label="Transactions">
      @for (g of groups(); track g.key; let last = $last) {
        <li class="group">
          <h2 class="group-head">
            <!-- Espaces finaux : séparent les morceaux dans le nom accessible du titre. -->
            <span>{{ g.label }} </span>
            <span class="group-total">
              <span class="muted">{{ last && nextCursor() ? 'Solde partiel' : 'Solde' }} </span>
              <span class="amount" [class.credit]="g.netCents > 0" [class.debit]="g.netCents < 0">{{ g.netCents | signedEur }}</span>
            </span>
          </h2>
          <ul class="group-rows">
            @for (t of g.items; track t.id) {
              <li class="row">
                @if (editing()?.id === t.id) {
                  <form class="form" [formGroup]="editForm" (ngSubmit)="save(t)" novalidate>
                    <div class="field">
                      <label for="e-amount">Montant (€)</label>
                      <!-- Le sens ne change pas ici : le signe le rappelle, en caractère et en couleur. -->
                      <div class="amount-input">
                        @if (t.type === CREDIT) {
                          <span class="amount-sign credit" aria-hidden="true">+</span>
                        } @else {
                          <span class="amount-sign debit" aria-hidden="true">−</span>
                        }
                        <input
                          id="e-amount"
                          formControlName="amount"
                          inputmode="decimal"
                          autocomplete="off"
                          [attr.aria-invalid]="editForm.controls.amount.invalid"
                          aria-describedby="e-amount-hint"
                        />
                      </div>
                      <p id="e-amount-hint" [class]="editForm.controls.amount.invalid ? 'field-error' : 'field-hint'">
                        Montant positif, ex. 12,34.
                      </p>
                    </div>
                    <div class="field">
                      <label for="e-name">Libellé</label>
                      <input id="e-name" formControlName="name" maxlength="100" autocomplete="off" />
                    </div>
                    <div class="field">
                      <label for="e-date">Date</label>
                      <input id="e-date" type="date" formControlName="date" />
                    </div>
                    @if (editOnOpening()) {
                      <fieldset class="field question" aria-describedby="e-count-hint">
                        <legend>Compter dans le solde ?</legend>
                        <p id="e-count-hint" [class]="editChoiceMissing() ? 'field-error' : 'field-hint'">
                          Même jour que le solde de départ du compte : cette transaction y est-elle déjà comprise ?
                        </p>
                        <label class="checkbox"><input type="radio" formControlName="countInBalance" value="true" /> Oui, l'ajouter au solde</label>
                        <label class="checkbox"><input type="radio" formControlName="countInBalance" value="false" /> Non, déjà comprise dans le solde de départ</label>
                      </fieldset>
                    }
                    <div class="actions">
                      <button class="button" type="submit" [disabled]="editForm.invalid || editChoiceMissing()">Enregistrer</button>
                      <button class="button button-secondary" type="button" (click)="editing.set(null)">Annuler la modification</button>
                    </div>
                  </form>
                } @else {
                  <div class="row-main">
                    <span class="row-title">
                      <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconOf(t)" /></svg>
                      <strong>{{ label(t) }}</strong>
                    </span>
                    <span class="muted">
                      @if (groupBy() !== 'day') {
                        {{ day(t.date) }} ·
                      }
                      {{ accountNames()[t.accountId] }} · {{ categoryOf(t) }}
                      @if (t.transferId) {
                        · Virement
                      }
                    </span>
                  </div>
                  <span class="amount" [class.credit]="t.type === CREDIT" [class.debit]="t.type !== CREDIT">
                    {{ (t.type === CREDIT ? t.amountCents : -t.amountCents) | signedEur }}
                  </span>
                  <div class="actions">
                    <!-- Jambe de virement : modifiable seulement via /transfers (une version pour les deux jambes). -->
                    @if (!t.transferId) {
                      <button type="button" class="button button-secondary" (click)="edit(t)">
                        Modifier<span class="visually-hidden"> {{ label(t) }}</span>
                      </button>
                    }
                    <button type="button" class="button button-secondary" (click)="remove(t)">
                      Supprimer<span class="visually-hidden"> {{ label(t) }}</span>
                    </button>
                  </div>
                  <app-attachment-control [transaction]="t" (changed)="setAttachment(t, $event)" />
                }
              </li>
            }
          </ul>
        </li>
      } @empty {
        @if (!loading()) {
          <li class="empty muted">Aucune transaction. <a routerLink="/transactions/new">Ajouter une transaction</a></li>
        }
      }
    </ul>

    @if (nextCursor()) {
      <div class="actions more">
        <button class="button button-secondary" type="button" [disabled]="loading()" (click)="loadMore()">Charger plus</button>
      </div>
    }
  `,
  // Mise en page seulement : champs, boutons, segmenté, montants, bandeaux et pastille viennent de la charte (styles.scss).
  styles: `
    .filters-panel {
      margin-bottom: var(--space-3);
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
    .list-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-3);
      font-size: var(--text-sm);
      .segmented {
        flex: 1 1 16rem;
        max-width: 22rem;
      }
    }
    .rows,
    .group-rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows {
      display: grid;
      gap: var(--space-4);
    }
    .group-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-1) var(--space-3);
      margin: 0 0 var(--space-2);
      font-size: var(--text-base);
    }
    .group-total {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      .muted {
        font-size: var(--text-sm);
        font-weight: var(--weight-regular);
      }
    }
    // Une surface par groupe, lignes séparées par un filet (pas de carte par ligne).
    .group-rows {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2) var(--space-3);
      align-items: start;
      padding: var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
      > .form,
      > .actions,
      > app-attachment-control {
        grid-column: 1 / -1;
      }
      > .form {
        max-width: none;
        margin: 0;
      }
    }
    .row-main {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
      overflow-wrap: anywhere;
      .muted {
        font-size: var(--text-sm);
      }
    }
    .row-title {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    @media (min-width: 768px) {
      .row {
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        > .actions {
          grid-row: 1;
          grid-column: 3;
        }
        > .form {
          grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
          align-items: start;
          > .question,
          > .actions {
            grid-column: 1 / -1;
          }
        }
      }
    }
    .empty {
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    .more {
      justify-content: center;
      margin-top: var(--space-4);
    }
  `,
})
export class HistoryPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly UNCATEGORIZED = UNCATEGORIZED;
  protected readonly NO_CATEGORY_LABEL = NO_CATEGORY_LABEL;
  protected readonly day = dayLabel;

  protected readonly accounts = signal<AccountDto[]>([]);
  protected readonly tags = signal<TagDto[]>([]);
  private readonly categories = signal<CategoryDto[]>([]);
  private readonly categoryById = computed(() => new Map(this.categories().map((c) => [c.id, c])));
  protected readonly accountNames = computed(() => Object.fromEntries(this.accounts().map((a) => [a.id, a.name])));
  /** Libellé « Parent › Enfant ». */
  protected readonly categoryLabels = computed(() => {
    const byId = this.categoryById();
    return Object.fromEntries(
      this.categories().map((c) => {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        return [c.id, parent ? `${categoryLabel(parent)} › ${categoryLabel(c)}` : categoryLabel(c)];
      }),
    );
  });
  /** Catégories (racines) et sous-catégories de la catégorie choisie dans les filtres, triées. */
  private options(parentId: string | null): { id: string; label: string }[] {
    return this.categories()
      .filter((c) => c.parentId === parentId)
      .map((c) => ({ id: c.id, label: categoryLabel(c) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }
  protected readonly parentOptions = computed(() => this.options(null));
  protected readonly subOptions = computed(() => {
    const parentId = this.filterCategory();
    return parentId && parentId !== UNCATEGORIZED ? this.options(parentId) : [];
  });

  protected readonly items = signal<TransactionDto[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly editing = signal<TransactionDto | null>(null);
  protected readonly undoable = signal<TransactionDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal(false);

  protected readonly groupBy = signal<GroupBy>('day');
  /** Lignes chargées regroupées par jour, semaine (lundi) ou mois, avec leur solde (revenus − dépenses, en centimes). */
  protected readonly groups = computed(() => {
    const by = this.groupBy();
    const groups = new Map<string, { label: string; netCents: number; items: TransactionDto[] }>();
    for (const t of this.items()) {
      const key = by === 'day' ? t.date : by === 'week' ? monday(t.date) : t.date.slice(0, 7);
      let g = groups.get(key);
      if (!g) {
        const label = by === 'day' ? dayLabel(key) : by === 'week' ? `Semaine du ${dayLabel(key)}` : MONTH.format(utc(`${key}-01`));
        groups.set(key, (g = { label, netCents: 0, items: [] }));
      }
      g.items.push(t);
      g.netCents += t.type === TransactionType.CREDIT ? t.amountCents : -t.amountCents;
    }
    return [...groups].map(([key, g]) => ({ key, ...g }));
  });

  protected readonly filters = this.fb.group({ from: '', to: '', accountId: '', categoryId: '', subcategoryId: '', tagId: '' });
  private readonly filterCategory = toSignal(this.filters.controls.categoryId.valueChanges, { initialValue: '' });
  /** Filtres de la recherche en cours : « Charger plus » les réutilise même si le formulaire a changé depuis. */
  private applied: TransactionListQuery = {};

  protected readonly editForm = this.fb.group({
    amount: ['', [Validators.required, amountValidator]],
    name: ['', Validators.maxLength(100)],
    date: ['', Validators.required],
    countInBalance: [''],
  });
  private readonly editValue = toSignal(this.editForm.valueChanges, { initialValue: this.editForm.value });
  // Déplacée sur le jour du solde de départ de son compte : l'API exige le choix (SPEC §3.3).
  protected readonly editOnOpening = computed(() => {
    const t = this.editing();
    const date = this.editValue().date;
    return !!t && date !== t.date && date === this.accounts().find((a) => a.id === t.accountId)?.openingDate;
  });
  protected readonly editChoiceMissing = computed(() => this.editOnOpening() && !this.editValue().countInBalance);

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
    this.fetch();
    // Filtres appliqués dès qu'ils changent ; le délai évite une requête par chiffre tapé dans une date.
    // Nouvelle catégorie ⇒ l'ancienne sous-catégorie n'a plus de sens.
    this.filters.controls.categoryId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.filters.controls.subcategoryId.setValue(''));
    this.filters.valueChanges.pipe(debounceTime(FILTER_DELAY_MS), takeUntilDestroyed()).subscribe(() => {
      if (JSON.stringify(this.query()) !== JSON.stringify(this.applied)) this.search();
    });
  }

  protected categoryOf(t: TransactionDto): string {
    return t.categoryId ? (this.categoryLabels()[t.categoryId] ?? '') : NO_CATEGORY_LABEL;
  }

  /** Icône de la catégorie racine (une sous-catégorie prend celle de son parent) ; sans catégorie ⇒ icône neutre. */
  protected iconOf(t: TransactionDto): string {
    const c = t.categoryId ? this.categoryById().get(t.categoryId) : undefined;
    const root = c?.parentId ? this.categoryById().get(c.parentId) : c;
    return root ? categoryIcon(root) : NO_CATEGORY_ICON;
  }

  protected label(t: TransactionDto): string {
    return t.name || (t.categoryId && this.categoryLabels()[t.categoryId]) || 'Transaction';
  }

  /** Champs vides ⇒ undefined ⇒ absents de l'URL (ApiClient). */
  // L'API filtre sur un seul categoryId (correspondance exacte) : la sous-catégorie l'emporte si elle est choisie.
  private query(): TransactionListQuery {
    const { subcategoryId, categoryId, ...rest } = this.filters.getRawValue();
    return Object.fromEntries(Object.entries({ ...rest, categoryId: subcategoryId || categoryId }).map(([k, v]) => [k, v || undefined]));
  }

  protected search(): void {
    this.applied = this.query();
    this.reload();
  }

  protected clearFilters(): void {
    this.filters.reset(undefined, { emitEvent: false });
    this.search();
  }

  /** Repart de la première page avec les filtres appliqués. */
  protected reload(): void {
    this.error.set(null);
    this.conflict.set(false);
    this.editing.set(null);
    this.fetch();
  }

  protected loadMore(): void {
    this.fetch(this.nextCursor() ?? undefined);
  }

  private fetch(cursor?: string): void {
    this.loading.set(true);
    this.api.get<TransactionPage>('/transactions', { ...this.applied, cursor }).subscribe({
      next: (page) => {
        this.items.update((list) => (cursor ? [...list, ...page.items] : page.items));
        this.nextCursor.set(page.nextCursor);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.fail(e);
      },
    });
  }

  protected edit(t: TransactionDto): void {
    this.editing.set(t);
    this.editForm.reset({ amount: centsToEuros(t.amountCents), name: t.name, date: t.date, countInBalance: '' });
  }

  protected save(t: TransactionDto): void {
    if (this.editForm.invalid || this.editChoiceMissing()) return;
    const { amount, name, date, countInBalance } = this.editForm.getRawValue();
    const body: UpdateTransactionInput = {
      version: t.version,
      amountCents: eurosToCents(amount)!,
      name: name.trim(),
      date,
      ...(this.editOnOpening() ? { countInBalance: countInBalance === 'true' } : {}),
    };
    this.error.set(null);
    this.api.patch<TransactionDto>(`/transactions/${t.id}`, body).subscribe({
      next: (updated) => {
        this.editing.set(null);
        this.items.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      },
      error: (e) => this.fail(e),
    });
  }

  protected setAttachment(t: TransactionDto, attachment: AttachmentDto | null): void {
    this.items.update((list) => list.map((x) => (x.id === t.id ? { ...x, attachment } : x)));
  }

  protected remove(t: TransactionDto): void {
    this.error.set(null);
    this.api.delete(`/transactions/${t.id}`).subscribe({
      next: () => {
        // Jambe de virement : l'API supprime les deux jambes.
        this.items.update((list) => list.filter((x) => x.id !== t.id && !(t.transferId && x.transferId === t.transferId)));
        if (this.editing()?.id === t.id) this.editing.set(null);
        this.undoable.set(t);
      },
      error: (e) => this.fail(e),
    });
  }

  protected restore(t: TransactionDto): void {
    this.undoable.set(null);
    this.api.post(`/transactions/${t.id}/restore`).subscribe({ next: () => this.reload(), error: (e) => this.fail(e) });
  }

  private fail(e: unknown): void {
    this.conflict.set(e instanceof HttpErrorResponse && e.status === 409);
    this.error.set(
      errorMessage(e, {
        400: 'Filtres ou montant invalides.',
        404: 'Cette transaction n’existe plus. Rechargez la liste.',
        409: 'Cette transaction a été modifiée depuis un autre écran. Rechargez pour voir la dernière version.',
      }),
    );
  }
}
