import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
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
import { QuickEntry } from '../../core/quick-entry';
import { today } from '../../core/today';
import { categoryOptions } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

// Saisie en 3 champs (SPEC §7) : montant, catégorie, compte. Date = aujourd'hui, le reste est replié.
// Catégorie puis sous-catégorie : deux listes liées, toutes deux facultatives (SPEC §3.2).
// Page (/transactions/new) ou modale de la coquille (« + Transaction »), selon `modal`.
@Component({
  selector: 'app-transaction-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="entry-head">
      @if (modal()) {
        <h2 id="entry-title">Ajouter une transaction</h2>
      } @else {
        <h1>Ajouter une transaction</h1>
      }
      <p><a routerLink="/transfers/new">Faire un virement entre comptes</a></p>
    </div>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <form class="form" [class.card]="!modal()" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <!-- Sens en tête, toujours visible (charte §7) ; pilote le même contrôle « type » qu'avant. -->
      <fieldset class="field">
        <legend>Sens</legend>
        <div id="tx-type" class="segmented">
          <button type="button" [attr.aria-pressed]="form.controls.type.value === DEBIT" (click)="form.controls.type.setValue(DEBIT)">
            Dépense
          </button>
          <button type="button" [attr.aria-pressed]="form.controls.type.value === CREDIT" (click)="form.controls.type.setValue(CREDIT)">
            Revenu
          </button>
        </div>
      </fieldset>

      <div class="field">
        <label for="tx-amount">Montant (€)</label>
        <!-- Signe selon le sens : la couleur ne porte jamais seule l'information. -->
        <div class="amount-input">
          @if (form.controls.type.value === CREDIT) {
            <span class="amount-sign credit" aria-hidden="true">+</span>
          } @else {
            <span class="amount-sign debit" aria-hidden="true">−</span>
          }
          <input
            id="tx-amount"
            formControlName="amount"
            inputmode="decimal"
            autocomplete="off"
            [attr.aria-invalid]="invalid('amount')"
            aria-describedby="tx-amount-hint"
          />
        </div>
        <p id="tx-amount-hint" [class]="invalid('amount') ? 'field-error' : 'field-hint'">
          Montant positif, ex. 12,34.
        </p>
      </div>

      <div class="field">
        <label for="tx-category">Catégorie (facultatif)</label>
        <select id="tx-category" formControlName="categoryId" (change)="form.controls.subcategoryId.setValue('')">
          <option value="">Sans catégorie</option>
          @for (c of categories(); track c.id) {
            <option [value]="c.id">{{ c.label }}</option>
          }
        </select>
      </div>

      @if (subcategories().length) {
        <div class="field">
          <label for="tx-subcategory">Sous-catégorie (facultatif)</label>
          <select id="tx-subcategory" formControlName="subcategoryId">
            <option value="">Aucune</option>
            @for (c of subcategories(); track c.id) {
              <option [value]="c.id">{{ c.label }}</option>
            }
          </select>
        </div>
      }

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

      <details class="more">
        <summary>Plus de détails (facultatif)</summary>
        <div class="form">
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
        <fieldset class="field question" aria-describedby="tx-count-hint">
          <legend>Compter dans le solde ?</legend>
          <p id="tx-count-hint" [class]="choiceMissing() ? 'field-error' : 'field-hint'">
            Même jour que le solde de départ du compte : cette transaction y est-elle déjà comprise ?
          </p>
          <label class="checkbox"><input type="radio" formControlName="countInBalance" value="true" /> Oui, l'ajouter au solde</label>
          <label class="checkbox"><input type="radio" formControlName="countInBalance" value="false" /> Non, déjà comprise dans le solde de départ</label>
        </fieldset>
      } @else if (beforeOpening()) {
        <p id="tx-before-opening" class="alert" role="status">
          Antérieure au solde de départ : visible dans l'historique et les statistiques, sans changer le solde.
        </p>
      }

      <div class="actions">
        <button class="button" type="submit" [disabled]="pending()">Enregistrer</button>
        @if (modal()) {
          <button class="button button-secondary" type="button" (click)="quick.open.set(null)">Annuler</button>
        }
      </div>
    </form>
  `,
  // Mise en page seulement : champs, segmenté, montant, question, bandeaux et boutons viennent de la charte (styles.scss).
  styles: `
    .entry-head {
      margin-bottom: var(--space-3);
      h1,
      h2 {
        margin-bottom: var(--space-1);
      }
      p {
        margin: 0;
      }
    }
    .form.card {
      padding: var(--space-4);
    }
    .more {
      summary {
        padding-block: calc((var(--tap) - 1lh) / 2);
        color: var(--color-primary);
        font-weight: var(--weight-medium);
        cursor: pointer;
      }
      .form {
        margin: var(--space-2) 0 0;
      }
    }
    .alert {
      margin: 0;
    }
  `,
})
export class TransactionFormPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  protected readonly quick = inject(QuickEntry);
  /** Dans la modale de la coquille : titre h2, bouton Annuler, fin signalée à la coquille au lieu d'une navigation. */
  readonly modal = input(false);

  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly CREDIT = TransactionType.CREDIT;

  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allCategories = signal<CategoryDto[]>([]);
  protected readonly categories = computed(() => categoryOptions(this.allCategories(), null));
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: ['', [Validators.required, amountValidator]],
    categoryId: [''],
    subcategoryId: [''],
    accountId: ['', Validators.required],
    type: [TransactionType.DEBIT],
    date: [today(), Validators.required],
    name: ['', Validators.maxLength(100)],
    details: ['', Validators.maxLength(1000)],
    countInBalance: [''],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  /** Sous-catégories de la catégorie choisie ; aucune catégorie ⇒ liste masquée. */
  protected readonly subcategories = computed(() => {
    const parentId = this.value().categoryId;
    return parentId ? categoryOptions(this.allCategories(), parentId) : [];
  });
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

  protected invalid(name: 'amount' | 'accountId'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.choiceMissing()) {
      this.form.markAllAsTouched();
      return;
    }
    const { amount, categoryId, subcategoryId, accountId, type, date, name, details, countInBalance } = this.form.getRawValue();
    const body: CreateTransactionInput = {
      accountId,
      ...(categoryId ? { categoryId } : {}),
      ...(categoryId && subcategoryId ? { subcategoryId } : {}),
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
      // Page : retour aux comptes, soldes relus. Modale : la coquille ferme et la page courante relit ses données.
      next: () => (this.modal() ? this.quick.saved.next('Transaction enregistrée.') : this.router.navigateByUrl('/accounts')),
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
