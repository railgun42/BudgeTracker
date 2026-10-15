import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccountDto, CreateTransferInput, eurosToCents, TrackingType } from '@budgetracker/shared';
import { ApiClient } from '../../core/api-client';
import { amountValidator } from '../../core/money';
import { QuickEntry } from '../../core/quick-entry';
import { today } from '../../core/today';
import { errorMessage } from '../auth/auth-form';

const sameAccount = (g: AbstractControl): ValidationErrors | null => {
  const { fromAccountId, toAccountId } = g.value as { fromAccountId: string; toAccountId: string };
  return fromAccountId && fromAccountId === toAccountId ? { sameAccount: true } : null;
};

// Virement (SPEC §3.4) : deux jambes créées par l'API ; vers un portefeuille non suivi, une seule dépense « Espèces ».
// Page (/transfers/new) ou modale de la coquille, selon `modal`.
@Component({
  selector: 'app-transfer-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (modal()) {
      <h2 id="entry-title">Nouveau virement</h2>
    } @else {
      <h1>Nouveau virement</h1>
    }

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <form class="form transfer" [class.card]="!modal()" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <!-- Source → cible : empilés (flèche ↓) ; côte à côte (flèche →) quand le formulaire est assez large. -->
      <div class="route">
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

        <div class="route-mid">
          <svg class="route-arrow" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M12 4v16m-6-6 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          </svg>
          <!-- Désactivé vers un portefeuille : il ne peut pas être débité. -->
          <button type="button" class="button button-secondary" (click)="swap()" [disabled]="toPortfolio()">Échanger les comptes</button>
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
            <p id="transfer-to-hint" class="alert alert-warning">
              Vers un portefeuille non suivi, le virement compte comme une dépense « Espèces ». Les achats que vous y
              saisirez ensuite s'ajoutent aux statistiques : c'est un double comptage assumé.
            </p>
          }
        </div>
      </div>

      <div class="field">
        <label for="transfer-amount">Montant (€)</label>
        <div class="amount-input">
          <input
            id="transfer-amount"
            formControlName="amount"
            inputmode="decimal"
            autocomplete="off"
            [attr.aria-invalid]="invalid('amount')"
            aria-describedby="transfer-amount-hint"
          />
        </div>
        <p id="transfer-amount-hint" [class]="invalid('amount') ? 'field-error' : 'field-hint'">
          Montant positif, ex. 12,34.
        </p>
      </div>

      <div class="field">
        <label for="transfer-date">Date</label>
        <input id="transfer-date" type="date" formControlName="date" />
      </div>

      @if (onOpening()) {
        <fieldset class="field question" aria-describedby="transfer-count-hint">
          <legend>Compter dans le solde ?</legend>
          <p id="transfer-count-hint" [class]="choiceMissing() ? 'field-error' : 'field-hint'">
            Même jour que le solde de départ d'un des comptes : ce virement y est-il déjà compris ?
          </p>
          <label class="checkbox"><input type="radio" formControlName="countInBalance" value="true" /> Oui, l'ajouter au solde</label>
          <label class="checkbox"><input type="radio" formControlName="countInBalance" value="false" /> Non, déjà comprise dans le solde de départ</label>
        </fieldset>
      } @else if (beforeOpening()) {
        <p id="transfer-before-opening" class="alert" role="status">
          Antérieure au solde de départ : visible dans l'historique et les statistiques, sans changer le solde.
        </p>
      }

      <div class="field">
        <label for="transfer-name">Libellé (facultatif)</label>
        <input id="transfer-name" formControlName="name" maxlength="100" autocomplete="off" />
      </div>

      <div class="actions">
        <button class="button" type="submit" [disabled]="pending()">Virer</button>
        @if (modal()) {
          <button class="button button-secondary" type="button" (click)="quick.open.set(null)">Annuler</button>
        }
      </div>
    </form>

    @if (!modal()) {
      <p><a routerLink="/accounts">Retour aux comptes</a></p>
    }
  `,
  // Mise en page seulement : champs, montant, question, bandeaux et boutons viennent de la charte (styles.scss).
  styles: `
    .form.card {
      padding: var(--space-4);
    }
    .transfer {
      container-type: inline-size;
    }
    .route {
      display: grid;
      gap: var(--space-3);
    }
    .route-mid {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      color: var(--color-text-muted);
    }
    .alert {
      margin: 0;
    }
    // Page sur bureau : formulaire élargi pour placer source | → | cible côte à côte. La modale (32rem) reste empilée.
    @media (min-width: 768px) {
      .form.card {
        max-width: 44rem;
      }
    }
    @container (min-width: 36rem) {
      .route {
        grid-template-columns: 1fr auto 1fr;
        align-items: start;
      }
      .route-mid {
        flex-direction: column;
        gap: var(--space-1);
        padding-top: calc(var(--text-sm) * var(--leading) + var(--space-1));
      }
      .route-arrow {
        rotate: -90deg;
      }
    }
  `,
})
export class TransferFormPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  protected readonly quick = inject(QuickEntry);
  /** Dans la modale de la coquille : titre h2, bouton Annuler, fin signalée à la coquille au lieu d'une navigation. */
  readonly modal = input(false);

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
      countInBalance: [''],
    },
    { validators: sameAccount },
  );
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly toPortfolio = computed(
    () => this.accounts().find((a) => a.id === this.value().toAccountId)?.trackingType === TrackingType.NOT_TRACKED,
  );

  // Règle du solde de départ appliquée jambe par jambe (SPEC §3.3) : chaque compte a le sien.
  private readonly openingDates = computed(() =>
    this.accounts()
      .filter((a) => a.id === this.value().fromAccountId || a.id === this.value().toAccountId)
      .flatMap((a) => (a.openingDate ? [a.openingDate] : [])),
  );
  protected readonly onOpening = computed(() => this.openingDates().includes(this.value().date ?? ''));
  protected readonly beforeOpening = computed(() => this.openingDates().some((d) => (this.value().date ?? '') < d));
  private readonly submitted = signal(false);
  protected readonly choiceMissing = computed(() => this.submitted() && this.onOpening() && !this.value().countInBalance);

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

  protected swap(): void {
    const { fromAccountId, toAccountId } = this.form.getRawValue();
    this.form.patchValue({ fromAccountId: toAccountId, toAccountId: fromAccountId });
  }

  protected same(): boolean {
    return this.form.hasError('sameAccount') && this.form.controls.toAccountId.touched;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.choiceMissing()) {
      this.form.markAllAsTouched();
      return;
    }
    const { fromAccountId, toAccountId, amount, date, name, countInBalance } = this.form.getRawValue();
    const body: CreateTransferInput = {
      fromAccountId,
      toAccountId,
      amountCents: eurosToCents(amount)!,
      date,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(this.onOpening() ? { countInBalance: countInBalance === 'true' } : {}),
    };
    this.pending.set(true);
    this.error.set(null);
    this.api.post('/transfers', body).subscribe({
      // Page : retour aux comptes. Modale : la coquille ferme et la page courante relit ses données.
      next: () => (this.modal() ? this.quick.saved.next('Virement enregistré.') : this.router.navigateByUrl('/accounts')),
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
