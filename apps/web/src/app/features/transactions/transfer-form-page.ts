import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccountDto, CreateTransferInput, eurosToCents, TrackingType } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { amountValidator } from '../../core/money';
import { today } from '../../core/today';
import { errorMessage } from '../auth/auth-form';

const sameAccount = (g: AbstractControl): ValidationErrors | null => {
  const { fromAccountId, toAccountId } = g.value as { fromAccountId: string; toAccountId: string };
  return fromAccountId && fromAccountId === toAccountId ? { sameAccount: true } : null;
};

// Virement (SPEC §3.4) : deux jambes créées par l'API ; vers un portefeuille non suivi, une seule dépense « Espèces ».
@Component({
  selector: 'app-transfer-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Nouveau virement</h1>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="transfer-from">Compte débité</label>
        <select
          id="transfer-from"
          formControlName="fromAccountId"
          [attr.aria-invalid]="invalid('fromAccountId')"
          aria-describedby="transfer-from-error"
        >
          <option value="">Choisir un compte</option>
          @for (a of sources(); track a.id) {
            <option [value]="a.id">{{ a.name }}</option>
          }
        </select>
        @if (invalid('fromAccountId')) {
          <p id="transfer-from-error" class="field-error">Choisissez le compte débité.</p>
        }
      </div>

      <div class="field">
        <label for="transfer-to">Compte crédité</label>
        <select
          id="transfer-to"
          formControlName="toAccountId"
          [attr.aria-invalid]="invalid('toAccountId') || same()"
          aria-describedby="transfer-to-error transfer-to-hint"
        >
          <option value="">Choisir un compte</option>
          @for (a of accounts(); track a.id) {
            <option [value]="a.id">{{ a.name }}</option>
          }
        </select>
        @if (same()) {
          <p id="transfer-to-error" class="field-error">Choisissez un compte différent du compte débité.</p>
        } @else if (invalid('toAccountId')) {
          <p id="transfer-to-error" class="field-error">Choisissez le compte crédité.</p>
        }
        @if (toPortfolio()) {
          <p id="transfer-to-hint" class="field-hint">
            Vers un portefeuille non suivi, le virement compte comme une dépense « Espèces ». Les achats que vous y
            saisirez ensuite s'ajoutent aux statistiques : c'est un double comptage assumé.
          </p>
        }
      </div>

      <div class="field">
        <label for="transfer-amount">Montant (€)</label>
        <input
          id="transfer-amount"
          formControlName="amount"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('amount')"
          aria-describedby="transfer-amount-hint"
        />
        <p id="transfer-amount-hint" [class]="invalid('amount') ? 'field-error' : 'field-hint'">
          Montant positif, ex. 12,34.
        </p>
      </div>

      <div class="field">
        <label for="transfer-date">Date</label>
        <input id="transfer-date" type="date" formControlName="date" />
      </div>

      <div class="field">
        <label for="transfer-name">Libellé (facultatif)</label>
        <input id="transfer-name" formControlName="name" maxlength="100" autocomplete="off" />
      </div>

      <button class="button" type="submit" [disabled]="pending()">Virer</button>
    </form>

    <p><a routerLink="/accounts">Retour aux comptes</a></p>
  `,
})
export class TransferFormPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly accounts = signal<AccountDto[]>([]);
  // Un portefeuille non suivi n'a pas de solde : il ne peut pas être débité par virement (422 côté API).
  protected readonly sources = computed(() => this.accounts().filter((a) => a.trackingType !== TrackingType.NOT_TRACKED));
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      fromAccountId: ['', Validators.required],
      toAccountId: ['', Validators.required],
      amount: ['', [Validators.required, amountValidator]],
      date: [today(), Validators.required],
      name: ['', Validators.maxLength(100)],
    },
    { validators: sameAccount },
  );
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly toPortfolio = computed(
    () => this.accounts().find((a) => a.id === this.value().toAccountId)?.trackingType === TrackingType.NOT_TRACKED,
  );

  constructor() {
    this.api.get<AccountDto[]>('/accounts').subscribe({
      next: (accounts) => this.accounts.set(accounts),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected invalid(name: 'fromAccountId' | 'toAccountId' | 'amount'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected same(): boolean {
    return this.form.hasError('sameAccount') && this.form.controls.toAccountId.touched;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { fromAccountId, toAccountId, amount, date, name } = this.form.getRawValue();
    const body: CreateTransferInput = {
      fromAccountId,
      toAccountId,
      amountCents: eurosToCents(amount)!,
      date,
      ...(name.trim() ? { name: name.trim() } : {}),
    };
    this.pending.set(true);
    this.error.set(null);
    this.api.post('/transfers', body).subscribe({
      next: () => this.router.navigateByUrl('/accounts'),
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            404: 'Un des comptes n’existe plus. Rechargez la page.',
            422: 'Virement refusé : comptes identiques ou compte débité non suivi.',
          }),
        );
      },
    });
  }
}
