import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AccountDto,
  AllowancePeriod,
  CASHFLOW_LIMITS,
  CashflowDto,
  CashflowInput,
  CashflowOneOffInput,
  CashflowRecurrenceInput,
  CashflowSimulationDto,
  CashflowSource,
  centsToEuros,
  CreateCashflowSimulationInput,
  eurosToCents,
  IntervalUnit,
  RecurrenceDto,
  TrackingType,
  TransactionType,
  UpdateCashflowSimulationInput,
} from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, EurPipe } from '../../core/money';
import { today } from '../../core/today';
import { UNIT_LABELS } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';
import { ProjectionChart } from './projection-chart';

export const SOURCE_LABELS: Record<CashflowSource, string> = {
  RECURRENCE: 'Récurrence',
  EXTRA_RECURRENCE: 'Récurrence simulée',
  ONE_OFF: 'Ponctuelle simulée',
  PLANNED: 'Transaction prévue',
};
const PERIOD_LABELS: Record<AllowancePeriod, string> = { MONTH: 'du mois', WEEK: 'de la semaine' };

/** Plancher facultatif, éventuellement négatif (découvert accepté) : « -50 » ou « 200,00 ». */
function signedAmountValidator(control: AbstractControl<string>): ValidationErrors | null {
  return !control.value.trim() || eurosToCents(control.value) !== null ? null : { amount: true };
}

type Params = Omit<CashflowInput, 'today'>;

// Simulation de trésorerie (SPEC §6.2) : « combien me restera-t-il au jour X ». Calcul serveur, rien n'est écrit dans
// les comptes ; une simulation sauvegardée se rouvre avec les dépenses réelles (enveloppe de la période en cours).
@Component({
  selector: 'app-cashflow-page',
  imports: [ReactiveFormsModule, RouterLink, EurPipe, ProjectionChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Simulation de trésorerie</h1>
    <p class="muted">
      Combien vous restera-t-il au jour choisi ? Les récurrences et dépenses ajoutées ici n'existent que dans la simulation.
      <a routerLink="/simulations">Scénarios « et si »</a>
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <section aria-labelledby="h-saved">
      <h2 id="h-saved">Mes simulations</h2>
      <ul class="cards" aria-label="Simulations sauvegardées">
        @for (s of saved(); track s.id) {
          <li class="card">
            <strong>{{ s.name }}</strong>
            <span class="muted"> du {{ s.params.startDate }} au {{ s.params.endDate }}</span>
            <div class="card-actions">
              <button type="button" class="button button-secondary" (click)="open(s)">
                Ouvrir<span class="visually-hidden"> {{ s.name }}</span>
              </button>
              <button type="button" class="button button-secondary" (click)="remove(s)">
                Supprimer<span class="visually-hidden"> {{ s.name }}</span>
              </button>
            </div>
          </li>
        } @empty {
          <li class="muted">Aucune simulation sauvegardée.</li>
        }
      </ul>
    </section>

    <form class="form" [formGroup]="form" (ngSubmit)="calculate()" novalidate>
      <h2>{{ editing() ? 'Simulation « ' + editing()!.name + ' »' : 'Nouvelle simulation' }}</h2>
      <fieldset>
        <legend>Comptes</legend>
        @for (a of accounts(); track a.id) {
          <label class="pick">
            <input type="checkbox" [checked]="accountIds().includes(a.id)" (change)="toggleAccount(a.id)" />
            {{ a.name }}
          </label>
        } @empty {
          <p class="muted">Aucun compte avec solde.</p>
        }
      </fieldset>
      <div class="field">
        <label for="cf-start">Date de début</label>
        <input id="cf-start" type="date" formControlName="startDate" [min]="todayDate" aria-describedby="cf-start-hint" />
        <p id="cf-start-hint" class="field-hint">Aujourd'hui au plus tôt.</p>
      </div>
      <div class="field">
        <label for="cf-end">Date de fin (jour X)</label>
        <input id="cf-end" type="date" formControlName="endDate" [min]="todayDate" [attr.aria-invalid]="invalid(form.controls.endDate)" />
      </div>

      <fieldset>
        <legend>Récurrences enregistrées</legend>
        @for (r of recurrences(); track r.id) {
          <label class="pick">
            <input type="checkbox" [checked]="!excluded().includes(r.id)" (change)="toggleRecurrence(r.id)" />
            {{ r.template.name || 'Sans libellé' }} : {{ r.template.type === CREDIT ? '+' : '−' }}{{ r.template.amountCents | eur }}, tous les
            {{ r.interval }} {{ units[r.unit] }}
          </label>
        } @empty {
          <p class="muted">Aucune récurrence sur les comptes choisis.</p>
        }
      </fieldset>

      @for (g of form.controls.extras.controls; track g; let i = $index) {
        <fieldset [formGroup]="g">
          <legend>Récurrence simulée {{ i + 1 }}</legend>
          <div class="field">
            <label [for]="'cf-x-name-' + i">Libellé</label>
            <input [id]="'cf-x-name-' + i" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="invalid(g.controls.name)" />
          </div>
          <div class="field">
            <label [for]="'cf-x-type-' + i">Sens</label>
            <select [id]="'cf-x-type-' + i" formControlName="type">
              <option [value]="DEBIT">Dépense</option>
              <option [value]="CREDIT">Revenu</option>
            </select>
          </div>
          <div class="field">
            <label [for]="'cf-x-amount-' + i">Montant (€)</label>
            <input [id]="'cf-x-amount-' + i" formControlName="amount" inputmode="decimal" autocomplete="off" [attr.aria-invalid]="invalid(g.controls.amount)" />
          </div>
          <div class="field">
            <label [for]="'cf-x-interval-' + i">Tous les</label>
            <input [id]="'cf-x-interval-' + i" type="number" min="1" max="1000" formControlName="interval" [attr.aria-invalid]="invalid(g.controls.interval)" />
          </div>
          <div class="field">
            <label [for]="'cf-x-unit-' + i">Unité</label>
            <select [id]="'cf-x-unit-' + i" formControlName="unit">
              @for (u of unitValues; track u) {
                <option [value]="u">{{ units[u] }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label [for]="'cf-x-start-' + i">Première échéance</label>
            <input [id]="'cf-x-start-' + i" type="date" formControlName="startDate" [attr.aria-invalid]="invalid(g.controls.startDate)" />
          </div>
          <div class="field">
            <label [for]="'cf-x-end-' + i">Dernière échéance (facultatif)</label>
            <input [id]="'cf-x-end-' + i" type="date" formControlName="endDate" />
          </div>
          <button type="button" class="link-button" (click)="form.controls.extras.removeAt(i)">Retirer la récurrence simulée {{ i + 1 }}</button>
        </fieldset>
      }
      @if (form.controls.extras.length < limits.maxExtraRecurrences) {
        <button type="button" class="button button-secondary" (click)="addExtra()">Ajouter une récurrence simulée</button>
      }

      @for (g of form.controls.oneOffs.controls; track g; let i = $index) {
        <fieldset [formGroup]="g">
          <legend>Dépense ou revenu ponctuel {{ i + 1 }}</legend>
          <div class="field">
            <label [for]="'cf-o-name-' + i">Libellé</label>
            <input [id]="'cf-o-name-' + i" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="invalid(g.controls.name)" />
          </div>
          <div class="field">
            <label [for]="'cf-o-type-' + i">Sens</label>
            <select [id]="'cf-o-type-' + i" formControlName="type">
              <option [value]="DEBIT">Dépense</option>
              <option [value]="CREDIT">Revenu</option>
            </select>
          </div>
          <div class="field">
            <label [for]="'cf-o-amount-' + i">Montant (€)</label>
            <input [id]="'cf-o-amount-' + i" formControlName="amount" inputmode="decimal" autocomplete="off" [attr.aria-invalid]="invalid(g.controls.amount)" />
          </div>
          <div class="field">
            <label [for]="'cf-o-date-' + i">Date</label>
            <input [id]="'cf-o-date-' + i" type="date" formControlName="date" [attr.aria-invalid]="invalid(g.controls.date)" />
          </div>
          <button type="button" class="link-button" (click)="form.controls.oneOffs.removeAt(i)">Retirer la ponctuelle {{ i + 1 }}</button>
        </fieldset>
      }
      @if (form.controls.oneOffs.length < limits.maxOneOffs) {
        <button type="button" class="button button-secondary" (click)="addOneOff()">Ajouter une dépense ou un revenu ponctuel</button>
      }

      <fieldset>
        <legend>Solde plancher (facultatif)</legend>
        <div class="field">
          <label for="cf-floor">Ne pas descendre sous (€)</label>
          <input
            id="cf-floor"
            formControlName="floor"
            inputmode="decimal"
            autocomplete="off"
            aria-describedby="cf-floor-hint"
            [attr.aria-invalid]="invalid(form.controls.floor)"
          />
          <p id="cf-floor-hint" class="field-hint">Ex. 200 ; négatif si un découvert est accepté.</p>
        </div>
        <div class="field">
          <label for="cf-period">Enveloppe par</label>
          <select id="cf-period" formControlName="period">
            <option value="MONTH">Mois</option>
            <option value="WEEK">Semaine</option>
          </select>
        </div>
      </fieldset>

      <button class="button" type="submit" [disabled]="pending()">Calculer</button>

      <div class="field">
        <label for="cf-name">Nom de la simulation</label>
        <input id="cf-name" [formControl]="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="invalid(name)" />
      </div>
      <div class="card-actions">
        <button type="button" class="button button-secondary" [disabled]="pending()" (click)="save()">
          {{ editing() ? 'Enregistrer les modifications' : 'Enregistrer la simulation' }}
        </button>
        @if (editing()) {
          <button type="button" class="button button-secondary" (click)="reset()">Nouvelle simulation</button>
        }
      </div>
    </form>

    @if (result(); as r) {
      <section aria-labelledby="h-result" aria-live="polite">
        <h2 id="h-result">Résultat</h2>
        <p class="end">
          Solde au {{ r.endDate }} : <strong>{{ r.endBalanceCents | eur }}</strong>
        </p>
        <p class="muted">
          Départ le {{ r.startDate }} : {{ r.startBalanceCents | eur }} · revenus +{{ r.creditCents | eur }} · dépenses −{{ r.debitCents | eur }}
        </p>
        @if (r.allowance; as a) {
          @if (a.belowFloor) {
            <p class="alert alert-error" role="alert">Le solde projeté passe sous le plancher de {{ a.floorCents | eur }} : aucune dépense libre possible.</p>
          }
          <dl class="allowance" aria-label="Enveloppe dépensable">
            <dt>Enveloppe {{ periodLabels[a.period] }} (du {{ a.current.from }} au {{ a.current.to }})</dt>
            <dd>{{ a.periodCents | eur }}</dd>
            <dt>Déjà dépensé</dt>
            <dd>{{ a.spentCents | eur }}</dd>
            <dt>Reste à dépenser</dt>
            <dd>
              <strong>{{ a.remainingCents | eur }}</strong>
            </dd>
          </dl>
          <p class="muted">Période {{ a.current.index + 1 }} sur {{ a.periods }} ; le reliquat d'une période se répartit sur les suivantes.</p>
        }

        <app-projection-chart [data]="chartData()!" baselineName="Solde projeté" />
        <details>
          <summary>Solde jour par jour</summary>
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" class="num">Solde</th>
                </tr>
              </thead>
              <tbody>
                @for (p of r.points; track $index) {
                  <tr>
                    <th scope="row">{{ p.date }}</th>
                    <td class="num">{{ p.balanceCents | eur }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </details>

        <div class="scroll">
          <table class="items">
            <caption>
              Détail de la période
            </caption>
            <thead>
              <tr>
                <th scope="col">Libellé</th>
                <th scope="col">Origine</th>
                <th scope="col" class="num">Occurrences</th>
                <th scope="col" class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (item of r.items; track $index) {
                <tr [class.excluded]="!item.included">
                  <th scope="row">
                    {{ item.name || 'Sans libellé' }}
                    @if (!item.included) {
                      <span class="muted">(décochée, hors solde)</span>
                    }
                  </th>
                  <td>{{ sourceLabels[item.source] }}</td>
                  <td class="num">{{ item.occurrences }}</td>
                  <td class="num">{{ item.type === CREDIT ? '+' : '−' }}{{ item.totalCents | eur }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="muted">Aucun mouvement sur la période.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    section {
      margin-bottom: var(--space-4);
    }
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
    .card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }
    fieldset {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      display: grid;
      gap: var(--space-2);
    }
    .pick {
      display: flex;
      gap: var(--space-2);
      align-items: center;
    }
    .end {
      font-size: 1.25rem;
    }
    .allowance {
      display: grid;
      grid-template-columns: auto auto;
      justify-content: start;
      gap: var(--space-1) var(--space-3);
    }
    .allowance dd {
      margin: 0;
      text-align: right;
    }
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--color-surface);
    }
    caption {
      text-align: left;
      padding: var(--space-2) 0;
    }
    th,
    td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .num {
      text-align: right;
      white-space: nowrap;
    }
    tbody th {
      font-weight: 400;
    }
    .excluded {
      text-decoration: line-through;
    }
  `,
})
export class CashflowPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly units = UNIT_LABELS;
  protected readonly unitValues = Object.values(IntervalUnit);
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly periodLabels = PERIOD_LABELS;
  protected readonly limits = CASHFLOW_LIMITS;
  protected readonly todayDate = today();

  /** Portefeuilles exclus : pas de solde à simuler. */
  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allRecurrences = signal<RecurrenceDto[]>([]);
  protected readonly saved = signal<CashflowSimulationDto[]>([]);
  protected readonly accountIds = signal<string[]>([]);
  /** Récurrences décochées (hors solde pour la simulation). */
  protected readonly excluded = signal<string[]>([]);
  protected readonly recurrences = computed(() => this.allRecurrences().filter((r) => this.accountIds().includes(r.accountId)));
  protected readonly result = signal<CashflowDto | null>(null);
  protected readonly chartData = computed(() => {
    const r = this.result();
    return r && { baseline: { averageMonthlySpendCents: 0, points: r.points }, scenarios: [] };
  });
  /** Simulation sauvegardée ouverte ; null ⇒ nouvelle. */
  protected readonly editing = signal<CashflowSimulationDto | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.group({
    startDate: [today(), Validators.required],
    endDate: ['', Validators.required],
    extras: this.fb.array([] as ReturnType<CashflowPage['extraGroup']>[]),
    oneOffs: this.fb.array([] as ReturnType<CashflowPage['oneOffGroup']>[]),
    floor: ['', signedAmountValidator],
    period: ['MONTH' as AllowancePeriod],
  });
  protected readonly name = this.fb.control('', [Validators.required, Validators.maxLength(CASHFLOW_LIMITS.maxNameLength)]);

  constructor() {
    forkJoin([this.api.get<AccountDto[]>('/accounts'), this.api.get<RecurrenceDto[]>('/recurrences')]).subscribe({
      next: ([accounts, recurrences]) => {
        this.accounts.set(accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED));
        this.allRecurrences.set(recurrences);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
    this.reload();
  }

  protected invalid(c: AbstractControl): boolean {
    return c.invalid && c.touched;
  }

  private extraGroup(r?: CashflowRecurrenceInput) {
    return this.fb.group({
      name: [r?.name ?? '', [Validators.required, Validators.maxLength(CASHFLOW_LIMITS.maxNameLength)]],
      type: [r?.type ?? TransactionType.DEBIT],
      amount: [r ? centsToEuros(r.amountCents) : '', [Validators.required, amountValidator]],
      interval: [r?.interval ?? 1, [Validators.required, Validators.min(1), Validators.max(1000)]],
      unit: [r?.unit ?? IntervalUnit.MONTH],
      startDate: [r?.startDate ?? today(), Validators.required],
      endDate: [r?.endDate ?? ''],
    });
  }

  private oneOffGroup(o?: CashflowOneOffInput) {
    return this.fb.group({
      name: [o?.name ?? '', [Validators.required, Validators.maxLength(CASHFLOW_LIMITS.maxNameLength)]],
      type: [o?.type ?? TransactionType.DEBIT],
      amount: [o ? centsToEuros(o.amountCents) : '', [Validators.required, amountValidator]],
      date: [o?.date ?? today(), Validators.required],
    });
  }

  protected addExtra(): void {
    this.form.controls.extras.push(this.extraGroup());
  }

  protected addOneOff(): void {
    this.form.controls.oneOffs.push(this.oneOffGroup());
  }

  protected toggleAccount(id: string): void {
    this.accountIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    this.refresh();
  }

  protected toggleRecurrence(id: string): void {
    this.excluded.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    this.refresh();
  }

  /** Un résultat affiché suit les cases cochées. */
  private refresh(): void {
    if (this.result()) this.calculate();
  }

  private reload(): void {
    this.api.get<CashflowSimulationDto[]>('/cashflow-simulations').subscribe({
      next: (list) => this.saved.set(list),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  /** Saisie ⇒ paramètres d'API, ou null (champs marqués) si incomplète. */
  private params(): Params | null {
    const v = this.form.getRawValue();
    if (this.form.invalid || !this.accountIds().length) {
      this.form.markAllAsTouched();
      this.error.set('Choisissez au moins un compte, une date de fin, et complétez chaque ligne (montants positifs, ex. 12,34).');
      return null;
    }
    const shown = new Set(this.recurrences().map((r) => r.id));
    const floorCents = v.floor.trim() ? eurosToCents(v.floor) : null;
    return {
      accountIds: this.accountIds(),
      // Une simulation sauvegardée déjà commencée repart d'aujourd'hui : l'API refuse un début passé.
      startDate: v.startDate > this.todayDate ? v.startDate : this.todayDate,
      endDate: v.endDate,
      excludedRecurrenceIds: this.excluded().filter((id) => shown.has(id)),
      extraRecurrences: v.extras.map((e) => ({
        name: e.name.trim(),
        type: e.type,
        amountCents: eurosToCents(e.amount)!,
        interval: Number(e.interval),
        unit: e.unit,
        startDate: e.startDate,
        endDate: e.endDate || null,
      })),
      oneOffs: v.oneOffs.map((o) => ({ name: o.name.trim(), type: o.type, amountCents: eurosToCents(o.amount)!, date: o.date })),
      ...(floorCents === null ? {} : { floor: { floorCents, period: v.period } }),
    };
  }

  private failed = (e: unknown) => {
    this.pending.set(false);
    this.error.set(
      errorMessage(e, {
        400: 'Simulation refusée : la fin doit suivre le début (et lui être postérieure avec un plancher), au plus 50 ans plus tard ; vérifiez les montants.',
        404: 'Un compte, une récurrence ou cette simulation n’existe plus. Rechargez la page.',
        409: 'Cette simulation a été modifiée entre-temps. Rechargez la page pour repartir de sa dernière version.',
        422: 'Simulation impossible : compte sans solde ou simulation terminée.',
      }),
    );
  };

  protected calculate(): void {
    const params = this.params();
    if (!params) return;
    this.pending.set(true);
    this.error.set(null);
    this.api.post<CashflowDto>('/simulations/cashflow', { ...params, today: this.todayDate } satisfies CashflowInput).subscribe({
      next: (r) => {
        this.pending.set(false);
        this.result.set(r);
      },
      error: this.failed,
    });
  }

  protected save(): void {
    const params = this.params();
    if (!params) return;
    if (this.name.invalid || !this.name.value.trim()) {
      this.name.markAsTouched();
      this.error.set('Donnez un nom à la simulation pour l’enregistrer.');
      return;
    }
    const body: CreateCashflowSimulationInput = { name: this.name.value.trim(), params, today: this.todayDate };
    const editing = this.editing();
    const request = editing
      ? this.api.patch<CashflowSimulationDto>(`/cashflow-simulations/${editing.id}`, { version: editing.version, ...body } satisfies UpdateCashflowSimulationInput)
      : this.api.post<CashflowSimulationDto>('/cashflow-simulations', body);
    this.pending.set(true);
    this.error.set(null);
    request.subscribe({
      next: (s) => {
        this.pending.set(false);
        this.editing.set(s);
        this.reload();
      },
      error: this.failed,
    });
  }

  /** Préremplit le formulaire et affiche le suivi : solde réel, dépenses de la période en cours, reliquat réparti. */
  protected open(s: CashflowSimulationDto): void {
    const p = s.params;
    this.editing.set(s);
    this.name.setValue(s.name);
    this.accountIds.set([...p.accountIds]);
    this.excluded.set([...(p.excludedRecurrenceIds ?? [])]);
    this.form.controls.extras.clear();
    (p.extraRecurrences ?? []).forEach((r) => this.form.controls.extras.push(this.extraGroup(r)));
    this.form.controls.oneOffs.clear();
    (p.oneOffs ?? []).forEach((o) => this.form.controls.oneOffs.push(this.oneOffGroup(o)));
    this.form.patchValue({
      startDate: p.startDate,
      endDate: p.endDate,
      floor: p.floor ? centsToEuros(p.floor.floorCents) : '',
      period: p.floor?.period ?? 'MONTH',
    });
    this.result.set(null);
    this.pending.set(true);
    this.error.set(null);
    this.api.get<CashflowDto>(`/cashflow-simulations/${s.id}/result`, { today: this.todayDate }).subscribe({
      next: (r) => {
        this.pending.set(false);
        this.result.set(r);
      },
      error: this.failed,
    });
  }

  protected reset(): void {
    this.editing.set(null);
    this.result.set(null);
    this.name.reset();
    this.accountIds.set([]);
    this.excluded.set([]);
    this.form.controls.extras.clear();
    this.form.controls.oneOffs.clear();
    this.form.reset();
  }

  protected remove(s: CashflowSimulationDto): void {
    this.api.delete(`/cashflow-simulations/${s.id}`).subscribe({
      next: () => {
        if (this.editing()?.id === s.id) this.reset();
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Cette simulation n’existe plus.' })),
    });
  }
}
