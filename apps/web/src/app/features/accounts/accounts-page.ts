import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AccountBalanceDto, AccountDto, CreateAccountInput, eurosToCents, TrackingType } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { EurPipe } from '../../core/money';
import { today } from '../../core/today';
import { TRACKING_TYPE_LABELS } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

/** Solde de départ : montant signé non nul (« -12,34 » accepté), champ vide = pas de solde de départ. */
function openingAmountValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value) return null;
  const cents = eurosToCents(control.value);
  return cents !== null && cents !== 0 ? null : { amount: true };
}

@Component({
  selector: 'app-accounts-page',
  imports: [ReactiveFormsModule, RouterLink, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mes comptes</h1>

    @if (undoable(); as deleted) {
      <p class="alert" role="status">
        Compte « {{ deleted.name }} » supprimé.
        <button type="button" class="link-button" (click)="restore(deleted)">Annuler</button>
      </p>
    }
    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        @if (conflict()) {
          <button type="button" class="link-button" (click)="reload()">Recharger</button>
        }
      </p>
    }

    <ul class="cards" aria-label="Comptes">
      @for (account of accounts(); track account.id) {
        <li class="card">
          <p class="card-title">
            <strong>{{ account.name }}</strong>
            <span class="muted">{{ labels[account.trackingType] }}</span>
          </p>
          <!-- NOT_TRACKED : aucun solde affiché (SPEC §7). -->
          @if (account.trackingType !== NOT_TRACKED) {
            @if (balances()[account.id]; as b) {
              <p class="balance" [class.negative]="b.currentCents! < 0">Solde : {{ b.currentCents | eur }}</p>
              @if (b.forecastCents !== b.currentCents) {
                <p class="muted">Prévisionnel : {{ b.forecastCents | eur }}</p>
              }
            }
          }
          <div class="actions">
            <button type="button" class="button button-secondary" (click)="edit(account)">
              Modifier<span class="visually-hidden"> {{ account.name }}</span>
            </button>
            <button type="button" class="button button-secondary" (click)="remove(account)">
              Supprimer<span class="visually-hidden"> {{ account.name }}</span>
            </button>
          </div>
        </li>
      } @empty {
        <li class="muted">Aucun compte pour l'instant : créez-en un ci-dessous.</li>
      }
    </ul>

    <p><a routerLink="/transfers/new">Faire un virement entre comptes</a></p>

    <h2>{{ editing() ? 'Modifier le compte' : 'Nouveau compte' }}</h2>
    <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="account-name">Nom</label>
        <input
          #nameInput
          id="account-name"
          formControlName="name"
          maxlength="100"
          autocomplete="off"
          [attr.aria-invalid]="invalid('name')"
          aria-describedby="account-name-error"
        />
        @if (invalid('name')) {
          <p id="account-name-error" class="field-error">Saisissez un nom.</p>
        }
      </div>

      <div class="field">
        <label for="account-type">Type de suivi</label>
        <select id="account-type" formControlName="trackingType">
          @for (type of types; track type) {
            <option [value]="type">{{ labels[type] }}</option>
          }
        </select>
      </div>

      @if (!editing() && trackingType() !== NOT_TRACKED) {
        <div class="field">
          <label for="account-opening">Solde de départ (€, facultatif)</label>
          <input
            id="account-opening"
            formControlName="openingAmount"
            inputmode="decimal"
            autocomplete="off"
            [attr.aria-invalid]="invalid('openingAmount')"
            aria-describedby="account-opening-hint"
          />
          <p id="account-opening-hint" [class]="invalid('openingAmount') ? 'field-error' : 'field-hint'">
            Ex. 1 234,56 ou -50 pour un découvert.
          </p>
        </div>
        <div class="field">
          <label for="account-opening-date">Date du solde de départ</label>
          <input id="account-opening-date" type="date" formControlName="openingDate" />
        </div>
      }

      <div class="actions">
        <button class="button" type="submit" [disabled]="pending()">{{ editing() ? 'Enregistrer' : 'Créer le compte' }}</button>
        @if (editing()) {
          <button class="button button-secondary" type="button" (click)="reset()">Annuler la modification</button>
        }
      </div>
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
      p {
        margin: 0 0 var(--space-2);
      }
    }
    .card-title {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: baseline;
    }
    .balance {
      font-size: 1.25rem;
      font-weight: 700;
    }
    .negative {
      color: var(--color-debit);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class AccountsPage {
  private readonly api = inject(ApiClient);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly NOT_TRACKED = TrackingType.NOT_TRACKED;
  protected readonly labels = TRACKING_TYPE_LABELS;
  protected readonly types = Object.values(TrackingType);

  protected readonly accounts = signal<AccountDto[]>([]);
  protected readonly balances = signal<Record<string, AccountBalanceDto>>({});
  protected readonly editing = signal<AccountDto | null>(null);
  protected readonly undoable = signal<AccountDto | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
    trackingType: [TrackingType.NORMAL],
    openingAmount: ['', openingAmountValidator],
    openingDate: [today(), Validators.required],
  });
  protected readonly trackingType = toSignal(this.form.controls.trackingType.valueChanges, {
    initialValue: TrackingType.NORMAL,
  });

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.error.set(null);
    this.conflict.set(false);
    this.api.get<AccountDto[]>('/accounts').subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.balances.set({});
        // ponytail: un GET de solde par compte suivi ; endpoint groupé si les utilisateurs ont des dizaines de comptes.
        for (const a of accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED)) {
          this.api
            .get<AccountBalanceDto>(`/accounts/${a.id}/balance`, { today: today() })
            .subscribe((b) => this.balances.update((all) => ({ ...all, [a.id]: b })));
        }
      },
      error: (e) => this.fail(e),
    });
  }

  protected invalid(name: 'name' | 'openingAmount'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected edit(account: AccountDto): void {
    this.editing.set(account);
    this.form.reset({ name: account.name, trackingType: account.trackingType, openingAmount: '', openingDate: today() });
    this.nameInput().nativeElement.focus();
  }

  protected reset(): void {
    this.editing.set(null);
    this.form.reset({ name: '', trackingType: TrackingType.NORMAL, openingAmount: '', openingDate: today() });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, trackingType, openingAmount, openingDate } = this.form.getRawValue();
    const editing = this.editing();
    const opening = trackingType !== TrackingType.NOT_TRACKED && openingAmount ? eurosToCents(openingAmount) : null;
    const body: CreateAccountInput = {
      name,
      trackingType,
      ...(opening ? { openingBalance: { amountCents: opening, date: openingDate } } : {}),
    };
    const request = editing
      ? this.api.patch<AccountDto>(`/accounts/${editing.id}`, { version: editing.version, name, trackingType })
      : this.api.post<AccountDto>('/accounts', body);

    this.pending.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.pending.set(false);
        this.reset();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.fail(e);
      },
    });
  }

  protected remove(account: AccountDto): void {
    this.error.set(null);
    this.api.delete(`/accounts/${account.id}`).subscribe({
      next: () => {
        if (this.editing()?.id === account.id) this.reset();
        this.undoable.set(account);
        this.reload();
      },
      error: (e) => this.fail(e),
    });
  }

  protected restore(account: AccountDto): void {
    this.undoable.set(null);
    this.api.post(`/accounts/${account.id}/restore`).subscribe({ next: () => this.reload(), error: (e) => this.fail(e) });
  }

  private fail(e: unknown): void {
    this.conflict.set(e instanceof HttpErrorResponse && e.status === 409);
    this.error.set(
      errorMessage(e, {
        404: 'Ce compte n’existe plus.',
        409: 'Ce compte a été modifié depuis un autre écran. Rechargez pour voir la dernière version.',
        422: 'Opération refusée : vérifiez le type de suivi et le solde de départ.',
      }),
    );
  }
}
