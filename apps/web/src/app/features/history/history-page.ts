import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, EurPipe } from '../../core/money';
import { categoryLabel, NO_CATEGORY_LABEL } from '../../shared-ui/labels';
import { UndoBanner } from '../../shared-ui/undo-banner';
import { errorMessage } from '../auth/auth-form';
import { AttachmentControl } from '../transactions/attachment-control';

// Historique paginé par curseur (50 par page côté API, « Charger plus »), filtres date/catégorie/tag/compte (SPEC §7).
@Component({
  selector: 'app-history-page',
  imports: [ReactiveFormsModule, RouterLink, EurPipe, UndoBanner, AttachmentControl],
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
          @for (c of categoryOptions(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </div>
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
        <button class="button" type="submit" [disabled]="loading()">Filtrer</button>
        <button class="button button-secondary" type="button" (click)="clearFilters()">Effacer les filtres</button>
      </div>
    </form>

    <ul class="rows" aria-label="Transactions">
      @for (t of items(); track t.id) {
        <li class="row">
          @if (editing()?.id === t.id) {
            <form class="form" [formGroup]="editForm" (ngSubmit)="save(t)" novalidate>
              <div class="field">
                <label for="e-amount">Montant (€)</label>
                <input
                  id="e-amount"
                  formControlName="amount"
                  inputmode="decimal"
                  autocomplete="off"
                  [attr.aria-invalid]="editForm.controls.amount.invalid"
                  aria-describedby="e-amount-hint"
                />
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
                <fieldset class="field" aria-describedby="e-count-hint">
                  <legend>Compter dans le solde ?</legend>
                  <p id="e-count-hint" class="field-hint">
                    Même jour que le solde de départ du compte : cette transaction y est-elle déjà comprise ?
                  </p>
                  <label><input type="radio" formControlName="countInBalance" value="true" /> Oui, l'ajouter au solde</label>
                  <label><input type="radio" formControlName="countInBalance" value="false" /> Non, déjà comprise dans le solde de départ</label>
                </fieldset>
              }
              <div class="actions">
                <button class="button" type="submit" [disabled]="editForm.invalid || editChoiceMissing()">Enregistrer</button>
                <button class="button button-secondary" type="button" (click)="editing.set(null)">Annuler la modification</button>
              </div>
            </form>
          } @else {
            <div class="row-main">
              <span class="muted">{{ t.date }}</span>
              <strong>{{ label(t) }}</strong>
              <span class="muted">
                {{ accountNames()[t.accountId] }} · {{ categoryOf(t) }}
                @if (t.transferId) {
                  · Virement
                }
              </span>
            </div>
            <span class="amount" [class.credit]="t.type === CREDIT" [class.debit]="t.type !== CREDIT">
              {{ t.type === CREDIT ? '+' : '' }}{{ (t.type === CREDIT ? t.amountCents : -t.amountCents) | eur }}
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
      } @empty {
        @if (!loading()) {
          <li class="muted">Aucune transaction. <a routerLink="/transactions/new">Ajouter une transaction</a></li>
        }
      }
    </ul>

    @if (nextCursor()) {
      <button class="button button-secondary" type="button" [disabled]="loading()" (click)="loadMore()">Charger plus</button>
    }
  `,
  styles: `
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-2);
      align-items: end;
      margin-bottom: var(--space-3);
    }
    .rows {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }
    .row-main {
      display: flex;
      flex-direction: column;
      flex: 1 1 12rem;
    }
    .amount {
      font-weight: 700;
      white-space: nowrap;
    }
    .credit {
      color: var(--color-credit);
    }
    .debit {
      color: var(--color-debit);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class HistoryPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly UNCATEGORIZED = UNCATEGORIZED;
  protected readonly NO_CATEGORY_LABEL = NO_CATEGORY_LABEL;

  protected readonly accounts = signal<AccountDto[]>([]);
  protected readonly tags = signal<TagDto[]>([]);
  private readonly categories = signal<CategoryDto[]>([]);
  protected readonly accountNames = computed(() => Object.fromEntries(this.accounts().map((a) => [a.id, a.name])));
  /** Libellé « Parent › Enfant ». */
  protected readonly categoryLabels = computed(() => {
    const byId = new Map(this.categories().map((c) => [c.id, c]));
    return Object.fromEntries(
      this.categories().map((c) => {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        return [c.id, parent ? `${categoryLabel(parent)} › ${categoryLabel(c)}` : categoryLabel(c)];
      }),
    );
  });
  protected readonly categoryOptions = computed(() =>
    Object.entries(this.categoryLabels())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  );

  protected readonly items = signal<TransactionDto[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly editing = signal<TransactionDto | null>(null);
  protected readonly undoable = signal<TransactionDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal(false);

  protected readonly filters = this.fb.group({ from: '', to: '', accountId: '', categoryId: '', tagId: '' });
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
  }

  protected categoryOf(t: TransactionDto): string {
    return t.categoryId ? (this.categoryLabels()[t.categoryId] ?? '') : NO_CATEGORY_LABEL;
  }

  protected label(t: TransactionDto): string {
    return t.name || (t.categoryId && this.categoryLabels()[t.categoryId]) || 'Transaction';
  }

  protected search(): void {
    // Champs vides ⇒ undefined ⇒ absents de l'URL (ApiClient).
    this.applied = Object.fromEntries(Object.entries(this.filters.getRawValue()).map(([k, v]) => [k, v || undefined]));
    this.reload();
  }

  protected clearFilters(): void {
    this.filters.reset();
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
