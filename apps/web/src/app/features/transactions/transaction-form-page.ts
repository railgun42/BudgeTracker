import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AccountDto,
  CategoryDto,
  CreateTransactionInput,
  eurosToCents,
  TrackingType,
  TransactionType,
} from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator } from '../../core/money';
import { today } from '../../core/today';
import { categoryLabel } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

// Catégories système posées par le serveur (intérêts, solde de départ, jambes de virement) : pas de saisie manuelle.
const RESERVED = new Set(['interest', 'opening_balance', 'transfer']);

// Saisie en 3 champs (SPEC §7) : montant, catégorie, compte. Date = aujourd'hui, le reste est replié.
@Component({
  selector: 'app-transaction-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Ajouter une transaction</h1>
    <p><a routerLink="/transfers/new">Faire un virement entre comptes</a></p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="tx-amount">Montant (€)</label>
        <input
          id="tx-amount"
          formControlName="amount"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('amount')"
          aria-describedby="tx-amount-hint"
        />
        <p id="tx-amount-hint" [class]="invalid('amount') ? 'field-error' : 'field-hint'">
          Montant positif, ex. 12,34.
        </p>
      </div>

      <div class="field">
        <label for="tx-category">Catégorie</label>
        <select
          id="tx-category"
          formControlName="categoryId"
          [attr.aria-invalid]="invalid('categoryId')"
          aria-describedby="tx-category-error"
        >
          <option value="">Choisir une catégorie</option>
          @for (c of categories(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
        @if (invalid('categoryId')) {
          <p id="tx-category-error" class="field-error">Choisissez une catégorie.</p>
        }
      </div>

      <div class="field">
        <label for="tx-account">Compte</label>
        <select
          id="tx-account"
          formControlName="accountId"
          [attr.aria-invalid]="invalid('accountId')"
          aria-describedby="tx-account-error"
        >
          <option value="">Choisir un compte</option>
          @for (a of accounts(); track a.id) {
            <option [value]="a.id">{{ a.name }}</option>
          }
        </select>
        @if (invalid('accountId')) {
          <p id="tx-account-error" class="field-error">
            @if (accounts().length) {
              Choisissez un compte.
            } @else {
              Aucun compte : <a routerLink="/accounts">créez-en un</a> d'abord.
            }
          </p>
        }
      </div>

      <details>
        <summary>Plus de détails (facultatif)</summary>
        <div class="form">
          <div class="field">
            <label for="tx-type">Sens</label>
            <select id="tx-type" formControlName="type">
              <option [value]="DEBIT">Dépense</option>
              <option [value]="CREDIT">Revenu</option>
            </select>
          </div>
          <div class="field">
            <label for="tx-date">Date</label>
            <input id="tx-date" type="date" formControlName="date" />
          </div>
          <div class="field">
            <label for="tx-name">Libellé</label>
            <input id="tx-name" formControlName="name" maxlength="100" autocomplete="off" />
          </div>
          <div class="field">
            <label for="tx-details">Notes</label>
            <textarea id="tx-details" formControlName="details" maxlength="1000" rows="3"></textarea>
          </div>
        </div>
      </details>

      @if (onOpening()) {
        <fieldset class="field" aria-describedby="tx-count-hint">
          <legend>Compter dans le solde ?</legend>
          <p id="tx-count-hint" [class]="choiceMissing() ? 'field-error' : 'field-hint'">
            Même jour que le solde de départ du compte : cette transaction y est-elle déjà comprise ?
          </p>
          <label><input type="radio" formControlName="countInBalance" value="true" /> Oui, l'ajouter au solde</label>
          <label><input type="radio" formControlName="countInBalance" value="false" /> Non, déjà comprise dans le solde de départ</label>
        </fieldset>
      } @else if (beforeOpening()) {
        <p id="tx-before-opening" class="field-hint">
          Antérieure au solde de départ : visible dans l'historique et les statistiques, sans changer le solde.
        </p>
      }

      <button class="button" type="submit" [disabled]="pending()">Enregistrer</button>
    </form>
  `,
})
export class TransactionFormPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly CREDIT = TransactionType.CREDIT;

  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allCategories = signal<CategoryDto[]>([]);
  /** Libellé « Parent › Enfant », trié. */
  protected readonly categories = computed(() => {
    const all = this.allCategories();
    const byId = new Map(all.map((c) => [c.id, c]));
    return all
      .filter((c) => !RESERVED.has(c.nameKey ?? ''))
      .map((c) => {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        return { id: c.id, label: parent ? `${categoryLabel(parent)} › ${categoryLabel(c)}` : categoryLabel(c) };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: ['', [Validators.required, amountValidator]],
    categoryId: ['', Validators.required],
    accountId: ['', Validators.required],
    type: [TransactionType.DEBIT],
    date: [today(), Validators.required],
    name: ['', Validators.maxLength(100)],
    details: ['', Validators.maxLength(1000)],
    countInBalance: [''],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  // Solde de départ du compte choisi (SPEC §3.3) : avant, hors solde ; le jour même, l'API exige un choix.
  private readonly openingDate = computed(() => this.accounts().find((a) => a.id === this.value().accountId)?.openingDate ?? null);
  protected readonly onOpening = computed(() => this.openingDate() !== null && this.value().date === this.openingDate());
  protected readonly beforeOpening = computed(() => this.openingDate() !== null && (this.value().date ?? '') < this.openingDate()!);
  private readonly submitted = signal(false);
  protected readonly choiceMissing = computed(() => this.submitted() && this.onOpening() && !this.value().countInBalance);

  constructor() {
    forkJoin([this.api.get<AccountDto[]>('/accounts'), this.api.get<CategoryDto[]>('/categories')]).subscribe({
      next: ([accounts, categories]) => {
        this.accounts.set(accounts);
        this.allCategories.set(categories);
        // Un seul compte : présélectionné, la saisie tombe à 2 champs.
        if (accounts.length === 1) this.form.controls.accountId.setValue(accounts[0].id);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected invalid(name: 'amount' | 'categoryId' | 'accountId'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.choiceMissing()) {
      this.form.markAllAsTouched();
      return;
    }
    const { amount, categoryId, accountId, type, date, name, details, countInBalance } = this.form.getRawValue();
    const body: CreateTransactionInput = {
      accountId,
      categoryId,
      amountCents: eurosToCents(amount)!,
      date,
      type,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(details.trim() ? { details: details.trim() } : {}),
      ...(this.onOpening() ? { countInBalance: countInBalance === 'true' } : {}),
    };
    this.pending.set(true);
    this.error.set(null);
    this.api.post('/transactions', body).subscribe({
      // Retour aux comptes : les soldes y sont relus, la dépense est visible tout de suite.
      next: () => this.router.navigateByUrl('/accounts'),
      error: (e) => {
        this.pending.set(false);
        const portfolio = this.accounts().find((a) => a.id === accountId)?.trackingType === TrackingType.NOT_TRACKED;
        this.error.set(
          errorMessage(e, {
            404: 'Ce compte ou cette catégorie n’existe plus. Rechargez la page.',
            422: portfolio ? 'Un portefeuille non suivi n’accepte que des dépenses.' : 'Transaction refusée.',
          }),
        );
      },
    });
  }
}
