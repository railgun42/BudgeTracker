import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AccountDto,
  CategoryDto,
  CreateRecurrenceInput,
  eurosToCents,
  IntervalUnit,
  RecurrenceDto,
  TransactionType,
} from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, EurPipe } from '../../core/money';
import { today } from '../../core/today';
import { categoryOptions, UNIT_LABELS } from '../../shared-ui/labels';
import { UndoBanner } from '../../shared-ui/undo-banner';
import { errorMessage } from '../auth/auth-form';

// UI minimale (E20) : liste, création, suppression avec annulation. Le serveur génère les occurrences
// jusqu'à aujourd'hui ; elles apparaissent ensuite dans l'historique comme des transactions ordinaires.
@Component({
  selector: 'app-recurrences-page',
  imports: [ReactiveFormsModule, EurPipe, UndoBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Récurrences</h1>

    @if (undoable(); as deleted) {
      <app-undo-banner [message]="'Récurrence « ' + (deleted.template.name || 'sans libellé') + ' » supprimée.'" (undo)="restore(deleted)" />
    }
    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <ul class="cards" aria-label="Récurrences">
      @for (r of recurrences(); track r.id) {
        <li class="card">
          <p>
            <strong>{{ r.template.name || 'Sans libellé' }}</strong> :
            {{ r.template.type === CREDIT ? '+' : '−' }}{{ r.template.amountCents | eur }},
            tous les {{ r.interval }} {{ units[r.unit] }} depuis le {{ r.startDate }}
            @if (r.endDate) {
              jusqu'au {{ r.endDate }}
            }
            <span class="muted">({{ accountName(r.accountId) }})</span>
          </p>
          <button type="button" class="button button-secondary" (click)="remove(r)">
            Supprimer<span class="visually-hidden"> {{ r.template.name }}</span>
          </button>
        </li>
      } @empty {
        <li class="muted">Aucune récurrence.</li>
      }
    </ul>

    <h2>Nouvelle récurrence</h2>
    <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="rec-amount">Montant (€)</label>
        <input
          id="rec-amount"
          formControlName="amount"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('amount')"
          aria-describedby="rec-amount-hint"
        />
        <p id="rec-amount-hint" [class]="invalid('amount') ? 'field-error' : 'field-hint'">Montant positif, ex. 12,34.</p>
      </div>
      <div class="field">
        <label for="rec-category">Catégorie (facultatif)</label>
        <select id="rec-category" formControlName="categoryId" (change)="form.controls.subcategoryId.setValue('')">
          <option value="">Sans catégorie</option>
          @for (c of categories(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </div>
      @if (subcategories().length) {
        <div class="field">
          <label for="rec-subcategory">Sous-catégorie (facultatif)</label>
          <select id="rec-subcategory" formControlName="subcategoryId">
            <option value="">Aucune</option>
            @for (c of subcategories(); track c.id) {
              <option [value]="c.id">{{ c.label }}</option>
            }
          </select>
        </div>
      }
      <div class="field">
        <label for="rec-account">Compte</label>
        <select id="rec-account" formControlName="accountId" [attr.aria-invalid]="invalid('accountId')">
          <option value="">Choisir un compte</option>
          @for (a of accounts(); track a.id) {
            <option [value]="a.id">{{ a.name }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="rec-type">Sens</label>
        <select id="rec-type" formControlName="type">
          <option [value]="DEBIT">Dépense</option>
          <option [value]="CREDIT">Revenu</option>
        </select>
      </div>
      <div class="field">
        <label for="rec-interval">Tous les</label>
        <input id="rec-interval" type="number" min="1" formControlName="interval" [attr.aria-invalid]="invalid('interval')" />
      </div>
      <div class="field">
        <label for="rec-unit">Unité</label>
        <select id="rec-unit" formControlName="unit">
          @for (u of unitValues; track u) {
            <option [value]="u">{{ units[u] }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="rec-start">Première échéance</label>
        <input id="rec-start" type="date" formControlName="startDate" />
      </div>
      <div class="field">
        <label for="rec-end">Dernière échéance (facultatif)</label>
        <input id="rec-end" type="date" formControlName="endDate" />
      </div>
      <div class="field">
        <label for="rec-name">Libellé</label>
        <input id="rec-name" formControlName="name" maxlength="100" autocomplete="off" />
      </div>
      <button class="button" type="submit" [disabled]="pending()">Créer la récurrence</button>
    </form>
  `,
  styles: `
    .cards {
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
  `,
})
export class RecurrencesPage {
  private readonly api = inject(ApiClient);

  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly units = UNIT_LABELS;
  protected readonly unitValues = Object.values(IntervalUnit);

  protected readonly recurrences = signal<RecurrenceDto[]>([]);
  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allCategories = signal<CategoryDto[]>([]);
  protected readonly categories = computed(() => categoryOptions(this.allCategories(), null));
  protected readonly undoable = signal<RecurrenceDto | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: ['', [Validators.required, amountValidator]],
    categoryId: [''],
    subcategoryId: [''],
    accountId: ['', Validators.required],
    type: [TransactionType.DEBIT],
    interval: [1, [Validators.required, Validators.min(1)]],
    unit: [IntervalUnit.MONTH],
    startDate: [today(), Validators.required],
    endDate: [''],
    name: ['', Validators.maxLength(100)],
  });
  private readonly categoryId = toSignal(this.form.controls.categoryId.valueChanges, { initialValue: '' });
  /** Sous-catégories de la catégorie choisie ; aucune catégorie ⇒ liste masquée. */
  protected readonly subcategories = computed(() => {
    const parentId = this.categoryId();
    return parentId ? categoryOptions(this.allCategories(), parentId) : [];
  });

  constructor() {
    forkJoin([this.api.get<AccountDto[]>('/accounts'), this.api.get<CategoryDto[]>('/categories')]).subscribe({
      next: ([accounts, categories]) => {
        this.accounts.set(accounts);
        this.allCategories.set(categories);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
    this.reload();
  }

  protected accountName(id: string): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '';
  }

  protected invalid(name: 'amount' | 'accountId' | 'interval'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  private reload(): void {
    this.api.get<RecurrenceDto[]>('/recurrences').subscribe({
      next: (list) => this.recurrences.set(list),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { amount, categoryId, subcategoryId, accountId, type, interval, unit, startDate, endDate, name } = this.form.getRawValue();
    const body: CreateRecurrenceInput = {
      accountId,
      interval: Number(interval),
      unit,
      startDate,
      ...(endDate ? { endDate } : {}),
      template: {
        ...(categoryId ? { categoryId } : {}),
        ...(categoryId && subcategoryId ? { subcategoryId } : {}),
        amountCents: eurosToCents(amount)!,
        type,
        ...(name.trim() ? { name: name.trim() } : {}),
      },
    };
    this.pending.set(true);
    this.error.set(null);
    this.api.post<RecurrenceDto>('/recurrences', body).subscribe({
      next: () => {
        this.pending.set(false);
        this.form.reset();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 404: 'Ce compte ou cette catégorie n’existe plus.', 422: 'Récurrence refusée : vérifiez les dates et le compte.' }));
      },
    });
  }

  protected remove(r: RecurrenceDto): void {
    this.api.delete(`/recurrences/${r.id}`).subscribe({
      next: () => {
        this.undoable.set(r);
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette récurrence n’existe plus.' })),
    });
  }

  protected restore(r: RecurrenceDto): void {
    this.undoable.set(null);
    this.api.post(`/recurrences/${r.id}/restore`).subscribe({ next: () => this.reload(), error: (e) => this.error.set(errorMessage(e)) });
  }
}
