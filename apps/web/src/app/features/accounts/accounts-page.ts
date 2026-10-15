import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import {
  AccountBalanceDto,
  AccountDto,
  centsToEuros,
  CreateAccountInput,
  CreateInterestRateInput,
  eurosToCents,
  InterestRatesDto,
  TrackingType,
} from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { EurPipe } from '../../core/money';
import { QuickEntry } from '../../core/quick-entry';
import { today } from '../../core/today';
import { TRACKING_TYPE_LABELS } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';

/** Solde de départ : montant signé non nul (« -12,34 » accepté), champ vide = pas de solde de départ. */
function openingAmountValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value) return null;
  const cents = eurosToCents(control.value);
  return cents !== null && cents !== 0 ? null : { amount: true };
}

// Taux annuel saisi en % avec 2 décimales max : même format que les euros, donc eurosToCents donne des points de base (« 3,25 » → 325).
function rateValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value) return null; // laissé à Validators.required
  const bp = eurosToCents(control.value);
  return bp !== null && bp >= 0 && bp <= 10_000 ? null : { rate: true };
}

@Component({
  selector: 'app-accounts-page',
  imports: [ReactiveFormsModule, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <h1>Mes comptes</h1>
      <div class="actions">
        <button type="button" class="button" (click)="create()">Nouveau compte</button>
        <button type="button" class="button button-secondary" (click)="quick.open.set('transfer')">Faire un virement entre comptes</button>
      </div>
    </div>

    @if (undoable(); as deleted) {
      <p class="alert undo-banner" role="status">
        <span>Compte « {{ deleted.name }} » supprimé.</span>
        <button type="button" class="button button-secondary" (click)="restore(deleted)">Annuler</button>
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
        <li class="card account">
          <div class="account-head">
            <p class="card-title">{{ account.name }}</p>
            <span class="badge badge-neutral">{{ labels[account.trackingType] }}</span>
          </div>
          <!-- NOT_TRACKED : aucun solde affiché (SPEC §7). -->
          @if (account.trackingType !== NOT_TRACKED) {
            @if (balances()[account.id]; as b) {
              <p class="balance" [class.negative]="b.currentCents! < 0">
                <span class="balance-label">Solde :</span> {{ b.currentCents | eur }}
              </p>
              @if (b.forecastCents !== b.currentCents) {
                <p class="muted">
                  Prévisionnel : <span class="amount" [class.negative]="b.forecastCents! < 0">{{ b.forecastCents | eur }}</span>
                </p>
              }
            } @else {
              <p class="muted" aria-busy="true">Chargement du solde…</p>
            }
          }
          @if (account.trackingType === WITH_INTEREST && rates()[account.id]; as r) {
            @if (r.missingRate) {
              <p class="alert alert-warning">Taux d'intérêt manquant : aucun intérêt ne sera crédité au 31/12.</p>
            } @else if (r.rates.at(-1); as rate) {
              <p class="muted">Taux : {{ percent(rate.rateBp) }} à partir du {{ rate.effectiveDate }}</p>
            }
          }
          <div class="card-actions">
            <button type="button" class="button button-secondary" (click)="edit(account)">
              Modifier<span class="visually-hidden"> {{ account.name }}</span>
            </button>
            @if (account.trackingType === WITH_INTEREST) {
              <button type="button" class="button button-secondary" (click)="openRate(account)">
                Définir le taux<span class="visually-hidden"> de {{ account.name }}</span>
              </button>
            }
            <button type="button" class="button button-secondary" (click)="remove(account)">
              Supprimer<span class="visually-hidden"> {{ account.name }}</span>
            </button>
          </div>
        </li>
      } @empty {
        <li class="empty muted">Aucun compte pour l'instant : créez-en un avec « Nouveau compte ».</li>
      }
    </ul>

    <!-- Modales natives : Échap, focus piégé et voile gérés par le navigateur ; la page derrière est inerte,
         d'où l'erreur répétée dans chaque modale (seule la copie visible est lue). -->
    <dialog #accountDialog class="modal" aria-labelledby="account-dialog-title" (close)="reset()">
      <h2 id="account-dialog-title">{{ editing() ? 'Modifier le compte' : 'Nouveau compte' }}</h2>
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
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
          <button class="button button-secondary" type="button" (click)="reset()">
            {{ editing() ? 'Annuler la modification' : 'Annuler' }}
          </button>
        </div>
      </form>
    </dialog>

    @if (interestAccounts().length) {
      <dialog #rateDialog class="modal" aria-labelledby="rate-dialog-title">
        <h2 id="rate-dialog-title">Taux d'intérêt</h2>
        @if (error()) {
          <p class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <form class="form" [formGroup]="rateForm" (ngSubmit)="submitRate()" novalidate>
          <div class="field">
            <label for="rate-account">Compte</label>
            <select id="rate-account" formControlName="accountId">
              @for (account of interestAccounts(); track account.id) {
                <option [value]="account.id">{{ account.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="rate-value">Taux annuel (%)</label>
            <input
              id="rate-value"
              formControlName="rate"
              inputmode="decimal"
              autocomplete="off"
              [attr.aria-invalid]="rateInvalid()"
              aria-describedby="rate-value-hint"
            />
            <p id="rate-value-hint" [class]="rateInvalid() ? 'field-error' : 'field-hint'">Entre 0 et 100, ex. 3 ou 2,4.</p>
          </div>
          <div class="field">
            <label for="rate-date">Date d'effet</label>
            <input id="rate-date" type="date" formControlName="effectiveDate" />
          </div>
          <div class="actions">
            <button class="button" type="submit" [disabled]="pending()">Enregistrer le taux</button>
            <button class="button button-secondary" type="button" (click)="rateDialog.close()">Annuler</button>
          </div>
        </form>
      </dialog>
    }
  `,
  // Mise en page seulement : cartes, boutons, champs, bandeaux et modales viennent de la charte (styles.scss).
  styles: `
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
      h1 {
        margin: 0;
      }
    }
    .cards {
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    }
    .account {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      p {
        margin: 0;
      }
    }
    .account-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-1) var(--space-2);
    }
    .balance-label {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
    }
    .account .card-actions {
      margin-top: auto;
      padding-top: var(--space-3);
      border-top: 1px solid var(--color-border);
    }
    .empty {
      grid-column: 1 / -1;
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
  `,
})
export class AccountsPage {
  private readonly api = inject(ApiClient);
  protected readonly quick = inject(QuickEntry);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
  private readonly accountDialog = viewChild.required<ElementRef<HTMLDialogElement>>('accountDialog');
  private readonly rateDialog = viewChild<ElementRef<HTMLDialogElement>>('rateDialog');

  protected readonly NOT_TRACKED = TrackingType.NOT_TRACKED;
  protected readonly WITH_INTEREST = TrackingType.WITH_INTEREST;
  protected readonly labels = TRACKING_TYPE_LABELS;
  protected readonly types = Object.values(TrackingType);

  protected readonly accounts = signal<AccountDto[]>([]);
  protected readonly balances = signal<Record<string, AccountBalanceDto>>({});
  protected readonly rates = signal<Record<string, InterestRatesDto>>({});
  protected readonly interestAccounts = computed(() => this.accounts().filter((a) => a.trackingType === TrackingType.WITH_INTEREST));
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
  protected readonly rateForm = inject(NonNullableFormBuilder).group({
    accountId: ['', Validators.required],
    rate: ['', [Validators.required, rateValidator]],
    effectiveDate: [today(), Validators.required],
  });
  protected readonly trackingType = toSignal(this.form.controls.trackingType.valueChanges, {
    initialValue: TrackingType.NORMAL,
  });

  constructor() {
    this.reload();
    // Transaction ou virement saisi dans la modale de la coquille : soldes relus.
    this.quick.saved.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
  }

  protected reload(): void {
    this.error.set(null);
    this.conflict.set(false);
    this.api.get<AccountDto[]>('/accounts').subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.balances.set({});
        this.rates.set({});
        const interest = this.interestAccounts();
        if (!interest.some((a) => a.id === this.rateForm.controls.accountId.value)) {
          this.rateForm.controls.accountId.setValue(interest[0]?.id ?? '');
        }
        for (const a of interest) {
          this.api
            .get<InterestRatesDto>(`/accounts/${a.id}/interest-rates`)
            .subscribe((r) => this.rates.update((all) => ({ ...all, [a.id]: r })));
        }
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

  protected percent(rateBp: number): string {
    return `${centsToEuros(rateBp)} %`;
  }

  protected rateInvalid(): boolean {
    const c = this.rateForm.controls.rate;
    return c.invalid && c.touched;
  }

  protected openRate(account: AccountDto): void {
    this.rateForm.controls.accountId.setValue(account.id);
    this.rateDialog()?.nativeElement.showModal();
  }

  // Même date d'effet ⇒ l'API remplace le taux.
  protected submitRate(): void {
    if (this.rateForm.invalid) {
      this.rateForm.markAllAsTouched();
      return;
    }
    const { accountId, rate, effectiveDate } = this.rateForm.getRawValue();
    const body: CreateInterestRateInput = { rateBp: eurosToCents(rate)!, effectiveDate };
    this.pending.set(true);
    this.error.set(null);
    this.api.post(`/accounts/${accountId}/interest-rates`, body).subscribe({
      next: () => {
        this.pending.set(false);
        this.rateForm.controls.rate.reset();
        this.rateDialog()?.nativeElement.close();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.fail(e);
      },
    });
  }

  protected invalid(name: 'name' | 'openingAmount'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected edit(account: AccountDto): void {
    this.editing.set(account);
    this.form.reset({ name: account.name, trackingType: account.trackingType, openingAmount: '', openingDate: today() });
    this.accountDialog().nativeElement.showModal();
    this.nameInput().nativeElement.focus();
  }

  protected create(): void {
    this.reset();
    this.accountDialog().nativeElement.showModal();
  }

  // Appelé aussi par l'événement `close` de la modale (Échap) : close() sur une modale déjà fermée ne fait rien.
  protected reset(): void {
    this.editing.set(null);
    this.form.reset({ name: '', trackingType: TrackingType.NORMAL, openingAmount: '', openingDate: today() });
    this.accountDialog().nativeElement.close();
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
