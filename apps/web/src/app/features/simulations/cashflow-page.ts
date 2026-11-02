import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
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
import { debounceTime, forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, EurPipe, SignedEurPipe } from '../../core/money';
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
// Affichage seulement : les dates restent 'YYYY-MM-DD' ; lues en UTC pour ne jamais changer de jour (comme l'historique).
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Délai avant de recalculer un résultat affiché après un changement de paramètre (comme les filtres de l'historique). */
export const RECALC_DELAY_MS = 300;

/** Plancher facultatif, éventuellement négatif (découvert accepté) : « -50 » ou « 200,00 ». */
function signedAmountValidator(control: AbstractControl<string>): ValidationErrors | null {
  return !control.value.trim() || eurosToCents(control.value) !== null ? null : { amount: true };
}

type Params = Omit<CashflowInput, 'today'>;

// Simulation de trésorerie (SPEC §6.2) : « combien me restera-t-il au jour X ». Calcul serveur, rien n'est écrit dans
// les comptes ; une simulation sauvegardée se rouvre avec les dépenses réelles (enveloppe de la période en cours).
@Component({
  selector: 'app-cashflow-page',
  imports: [ReactiveFormsModule, EurPipe, SignedEurPipe, ProjectionChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Simulation de trésorerie</h1>
    <p class="muted">
      Combien vous restera-t-il au jour choisi ? Les récurrences et dépenses ajoutées ici n'existent que dans la simulation.
    </p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <section aria-labelledby="h-saved">
      <h2 id="h-saved">Mes simulations</h2>
      <ul class="rows" aria-label="Simulations sauvegardées">
        @for (s of saved(); track s.id) {
          <li class="row">
            <div class="row-main">
              <span class="row-title">
                <strong>{{ s.name }}</strong>
                @if (editing()?.id === s.id) {
                  <span class="visually-hidden">, </span><span class="badge badge-neutral">ouverte</span>
                }
              </span>
              <span class="muted">du {{ day(s.params.startDate) }} au {{ day(s.params.endDate) }}</span>
            </div>
            <div class="actions">
              <button type="button" class="button button-secondary" (click)="open(s)">
                Ouvrir<span class="visually-hidden"> {{ s.name }}</span>
              </button>
              <button type="button" class="button button-secondary" (click)="remove(s)">
                Supprimer<span class="visually-hidden"> {{ s.name }}</span>
              </button>
            </div>
          </li>
        } @empty {
          <li class="empty muted">Aucune simulation sauvegardée.</li>
        }
      </ul>
    </section>

    <div class="layout">
      <form class="form params" [formGroup]="form" (ngSubmit)="calculate()" novalidate>
        <h2>{{ editing() ? 'Simulation « ' + editing()!.name + ' »' : 'Nouvelle simulation' }}</h2>

        <ol class="steps" aria-label="Étapes">
          @for (s of steps; track s; let i = $index) {
            <li>
              <button type="button" [attr.aria-current]="step() === i ? 'step' : null" (click)="goTo(i)">
                <span class="step-num" aria-hidden="true">{{ i + 1 }}</span>{{ s }}
              </button>
            </li>
          }
        </ol>

        <div class="step" [hidden]="step() !== 0">
          <h3 id="cf-step-0" tabindex="-1"><span class="visually-hidden">Étape 1 sur 3 : </span>{{ steps[0] }}</h3>
          <fieldset class="field">
            <legend>Comptes</legend>
            @for (a of accounts(); track a.id) {
              <label class="checkbox pick">
                <input type="checkbox" [checked]="accountIds().includes(a.id)" (change)="toggleAccount(a.id)" />
                {{ a.name }}
              </label>
            } @empty {
              <p class="muted">Aucun compte avec solde.</p>
            }
          </fieldset>
          <div class="pair">
            <div class="field">
              <label for="cf-start">Date de début</label>
              <input id="cf-start" type="date" formControlName="startDate" [min]="todayDate" aria-describedby="cf-start-hint" />
              <p id="cf-start-hint" class="field-hint">Aujourd'hui au plus tôt.</p>
            </div>
            <div class="field">
              <label for="cf-end">Date de fin (jour X)</label>
              <input id="cf-end" type="date" formControlName="endDate" [min]="todayDate" [attr.aria-invalid]="invalid(form.controls.endDate)" />
            </div>
          </div>
        </div>

        <div class="step" [hidden]="step() !== 1">
          <h3 id="cf-step-1" tabindex="-1"><span class="visually-hidden">Étape 2 sur 3 : </span>{{ steps[1] }}</h3>
          <fieldset class="field">
            <legend>Récurrences enregistrées</legend>
            @for (r of recurrences(); track r.id) {
              <label class="checkbox pick">
                <input type="checkbox" [checked]="!excluded().includes(r.id)" (change)="toggleRecurrence(r.id)" />
                <span class="pick-name">{{ r.template.name || 'Sans libellé' }}<span class="visually-hidden"> : </span></span>
                <span class="amount" [class]="r.template.type === CREDIT ? 'credit' : 'debit'">{{ signed(r.template.type, r.template.amountCents) | signedEur }}</span
                ><span class="visually-hidden">, </span>
                <span class="pick-meta muted">tous les {{ r.interval }} {{ units[r.unit] }}</span>
              </label>
            } @empty {
              <p class="muted">Aucune récurrence sur les comptes choisis.</p>
            }
          </fieldset>

          <h4>Récurrences simulées</h4>
          <ul class="sim-rows" aria-label="Récurrences simulées">
            @for (g of form.controls.extras.controls; track g; let i = $index) {
              @let v = g.getRawValue();
              <li class="sim-row">
                <span class="pick-name">{{ v.name }}<span class="visually-hidden"> : </span></span>
                <span class="amount" [class]="v.type === CREDIT ? 'credit' : 'debit'">{{ signed(v.type, cents(v.amount)) | signedEur }}</span
                ><span class="visually-hidden">, </span>
                <span class="pick-meta muted">
                  tous les {{ v.interval }} {{ units[v.unit] }} à partir du {{ day(v.startDate) }}
                  @if (v.endDate) {
                    jusqu'au {{ day(v.endDate) }}
                  }
                </span>
                <span class="actions">
                  <button type="button" class="link-button" (click)="editExtra(extraDialog, i)">
                    Modifier<span class="visually-hidden"> la récurrence simulée {{ i + 1 }}</span>
                  </button>
                  <button type="button" class="link-button" (click)="form.controls.extras.removeAt(i)">Retirer la récurrence simulée {{ i + 1 }}</button>
                </span>
              </li>
            } @empty {
              <li class="muted">Aucune récurrence simulée.</li>
            }
          </ul>
          @if (form.controls.extras.length < limits.maxExtraRecurrences) {
            <button type="button" class="button button-secondary" (click)="editExtra(extraDialog, form.controls.extras.length)">
              Ajouter une récurrence simulée
            </button>
          }

          <h4>Dépenses et revenus ponctuels</h4>
          <ul class="sim-rows" aria-label="Dépenses et revenus ponctuels simulés">
            @for (g of form.controls.oneOffs.controls; track g; let i = $index) {
              @let v = g.getRawValue();
              <li class="sim-row">
                <span class="pick-name">{{ v.name }}<span class="visually-hidden"> : </span></span>
                <span class="amount" [class]="v.type === CREDIT ? 'credit' : 'debit'">{{ signed(v.type, cents(v.amount)) | signedEur }}</span
                ><span class="visually-hidden">, </span>
                <span class="pick-meta muted">le {{ day(v.date) }}</span>
                <span class="actions">
                  <button type="button" class="link-button" (click)="editOneOff(oneOffDialog, i)">
                    Modifier<span class="visually-hidden"> la ponctuelle {{ i + 1 }}</span>
                  </button>
                  <button type="button" class="link-button" (click)="form.controls.oneOffs.removeAt(i)">Retirer la ponctuelle {{ i + 1 }}</button>
                </span>
              </li>
            } @empty {
              <li class="muted">Aucune dépense ni aucun revenu ponctuel.</li>
            }
          </ul>
          @if (form.controls.oneOffs.length < limits.maxOneOffs) {
            <button type="button" class="button button-secondary" (click)="editOneOff(oneOffDialog, form.controls.oneOffs.length)">
              Ajouter une dépense ou un revenu ponctuel
            </button>
          }
        </div>

        <div class="step" [hidden]="step() !== 2">
          <h3 id="cf-step-2" tabindex="-1"><span class="visually-hidden">Étape 3 sur 3 : </span>{{ steps[2] }}</h3>
          <fieldset class="field">
            <legend>Solde plancher (facultatif)</legend>
            <div class="pair">
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
            </div>
          </fieldset>
        </div>

        <div class="actions step-nav">
          @if (step() > 0) {
            <button type="button" class="button button-secondary" (click)="goTo(step() - 1)">Précédent</button>
          }
          @if (step() < steps.length - 1) {
            <button type="button" class="button button-secondary" (click)="goTo(step() + 1)">Suivant</button>
          }
          <button class="button" type="submit" [disabled]="pending()">Calculer</button>
        </div>

        <div class="save">
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
        </div>
      </form>

      <section class="result" aria-labelledby="h-result">
        <h2 id="h-result">Résultat</h2>
        @if (pending()) {
          <p class="muted" role="status">Chargement…</p>
        }
        <div aria-live="polite">
          @if (result(); as r) {
            <div class="appear">
              <p class="end">
                <span class="end-label">Solde au {{ day(r.endDate) }}<span class="visually-hidden"> : </span></span>
                <strong class="end-value amount" [class.credit]="r.endBalanceCents > 0" [class.debit]="r.endBalanceCents < 0">{{
                  r.endBalanceCents | signedEur
                }}</strong>
              </p>
              <ul class="stat-grid">
                <li class="card stat">
                  <p class="stat-label">Départ le {{ day(r.startDate) }}</p>
                  <p class="stat-value" [class.debit]="r.startBalanceCents < 0">{{ r.startBalanceCents | signedEur }}</p>
                </li>
                <li class="card stat">
                  <p class="stat-label">Revenus</p>
                  <p class="stat-value credit">{{ r.creditCents | signedEur }}</p>
                </li>
                <li class="card stat">
                  <p class="stat-label">Dépenses</p>
                  <p class="stat-value debit">{{ -r.debitCents | signedEur }}</p>
                </li>
              </ul>

              @if (r.allowance; as a) {
                @if (a.belowFloor) {
                  <p class="alert alert-error" role="alert">Le solde projeté passe sous le plancher de {{ a.floorCents | eur }} : aucune dépense libre possible.</p>
                }
                <div class="card envelope">
                  <h3>Enveloppe dépensable</h3>
                  <div class="gauge" aria-hidden="true">
                    <span class="gauge-fill" [style.width.%]="remainingPct()"></span>
                  </div>
                  <p class="gauge-caption muted">{{ remainingPct() }} % de l'enveloppe reste à dépenser</p>
                  <dl class="allowance" aria-label="Enveloppe dépensable">
                    <dt>Enveloppe {{ periodLabels[a.period] }} (du {{ day(a.current.from) }} au {{ day(a.current.to) }})</dt>
                    <dd class="num">{{ a.periodCents | eur }}</dd>
                    <dt>Déjà dépensé</dt>
                    <dd class="num">{{ a.spentCents | eur }}</dd>
                    <dt>Reste à dépenser</dt>
                    <dd class="num">
                      <strong class="balance" [class.debit]="a.remainingCents < 0">{{
                        a.remainingCents < 0 ? (a.remainingCents | signedEur) : (a.remainingCents | eur)
                      }}</strong>
                    </dd>
                  </dl>
                  <p class="muted hint">Période {{ a.current.index + 1 }} sur {{ a.periods }} ; le reliquat d'une période se répartit sur les suivantes.</p>
                </div>
              }
            </div>
          } @else if (!pending()) {
            <p class="empty muted">Choisissez au moins un compte et une date de fin, puis « Calculer ».</p>
          }
        </div>

        @if (result(); as r) {
          <div class="appear">
            <app-projection-chart [data]="chartData()!" baselineName="Solde projeté" [floorCents]="r.allowance?.floorCents ?? null" />
            <details class="daily">
              <summary>Solde jour par jour</summary>
              <div class="scroll">
                <table>
                  <caption class="visually-hidden">
                    Solde jour par jour
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col" class="num">Solde</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of r.points; track $index) {
                      <tr>
                        <th scope="row">{{ day(p.date) }}</th>
                        <td class="num" [class.debit]="p.balanceCents < 0">{{ p.balanceCents | signedEur }}</td>
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
                      <td class="num amount" [class]="item.included ? (item.type === CREDIT ? 'credit' : 'debit') : ''">
                        {{ signed(item.type, item.totalCents) | signedEur }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4" class="muted">Aucun mouvement sur la période.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </section>
    </div>

    <dialog #extraDialog class="modal" aria-labelledby="cf-x-title">
      @let i = extraIndex();
      <h2 id="cf-x-title">Récurrence simulée {{ i + 1 }}</h2>
      <form class="form" [formGroup]="extraDraft" (ngSubmit)="keepExtra(extraDialog)" novalidate>
        <fieldset class="field">
          <legend>Sens</legend>
          <div [id]="'cf-x-type-' + i" class="segmented">
            <button type="button" [attr.aria-pressed]="extraDraft.controls.type.value === DEBIT" (click)="extraDraft.controls.type.setValue(DEBIT)">Dépense</button>
            <button type="button" [attr.aria-pressed]="extraDraft.controls.type.value === CREDIT" (click)="extraDraft.controls.type.setValue(CREDIT)">Revenu</button>
          </div>
        </fieldset>
        <div class="field">
          <label [for]="'cf-x-name-' + i">Libellé</label>
          <input [id]="'cf-x-name-' + i" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="invalid(extraDraft.controls.name)" />
        </div>
        <div class="field">
          <label [for]="'cf-x-amount-' + i">Montant (€)</label>
          <div class="amount-input">
            <span class="amount-sign" [class]="extraDraft.controls.type.value === CREDIT ? 'credit' : 'debit'" aria-hidden="true">{{
              extraDraft.controls.type.value === CREDIT ? '+' : '−'
            }}</span>
            <input
              [id]="'cf-x-amount-' + i"
              formControlName="amount"
              inputmode="decimal"
              autocomplete="off"
              [attr.aria-describedby]="'cf-x-amount-hint-' + i"
              [attr.aria-invalid]="invalid(extraDraft.controls.amount)"
            />
          </div>
          <p [id]="'cf-x-amount-hint-' + i" class="field-hint">Montant positif, ex. 12,34.</p>
        </div>
        <div class="pair">
          <div class="field">
            <label [for]="'cf-x-interval-' + i">Tous les</label>
            <input
              [id]="'cf-x-interval-' + i"
              type="number"
              min="1"
              max="1000"
              formControlName="interval"
              [attr.aria-invalid]="invalid(extraDraft.controls.interval)"
            />
          </div>
          <div class="field">
            <label [for]="'cf-x-unit-' + i">Unité</label>
            <select [id]="'cf-x-unit-' + i" formControlName="unit">
              @for (u of unitValues; track u) {
                <option [value]="u">{{ units[u] }}</option>
              }
            </select>
          </div>
        </div>
        <div class="pair">
          <div class="field">
            <label [for]="'cf-x-start-' + i">Première échéance</label>
            <input [id]="'cf-x-start-' + i" type="date" formControlName="startDate" [attr.aria-invalid]="invalid(extraDraft.controls.startDate)" />
          </div>
          <div class="field">
            <label [for]="'cf-x-end-' + i">Dernière échéance (facultatif)</label>
            <input [id]="'cf-x-end-' + i" type="date" formControlName="endDate" />
          </div>
        </div>
        <div class="actions">
          <button class="button" type="submit">{{ i < form.controls.extras.length ? 'Enregistrer la récurrence simulée' : 'Ajouter la récurrence simulée' }}</button>
          <button class="button button-secondary" type="button" (click)="extraDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>

    <dialog #oneOffDialog class="modal" aria-labelledby="cf-o-title">
      @let j = oneOffIndex();
      <h2 id="cf-o-title">Dépense ou revenu ponctuel {{ j + 1 }}</h2>
      <form class="form" [formGroup]="oneOffDraft" (ngSubmit)="keepOneOff(oneOffDialog)" novalidate>
        <fieldset class="field">
          <legend>Sens</legend>
          <div [id]="'cf-o-type-' + j" class="segmented">
            <button type="button" [attr.aria-pressed]="oneOffDraft.controls.type.value === DEBIT" (click)="oneOffDraft.controls.type.setValue(DEBIT)">Dépense</button>
            <button type="button" [attr.aria-pressed]="oneOffDraft.controls.type.value === CREDIT" (click)="oneOffDraft.controls.type.setValue(CREDIT)">Revenu</button>
          </div>
        </fieldset>
        <div class="field">
          <label [for]="'cf-o-name-' + j">Libellé</label>
          <input [id]="'cf-o-name-' + j" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="invalid(oneOffDraft.controls.name)" />
        </div>
        <div class="pair">
          <div class="field">
            <label [for]="'cf-o-amount-' + j">Montant (€)</label>
            <div class="amount-input">
              <span class="amount-sign" [class]="oneOffDraft.controls.type.value === CREDIT ? 'credit' : 'debit'" aria-hidden="true">{{
                oneOffDraft.controls.type.value === CREDIT ? '+' : '−'
              }}</span>
              <input
                [id]="'cf-o-amount-' + j"
                formControlName="amount"
                inputmode="decimal"
                autocomplete="off"
                [attr.aria-describedby]="'cf-o-amount-hint-' + j"
                [attr.aria-invalid]="invalid(oneOffDraft.controls.amount)"
              />
            </div>
            <p [id]="'cf-o-amount-hint-' + j" class="field-hint">Montant positif, ex. 12,34.</p>
          </div>
          <div class="field">
            <label [for]="'cf-o-date-' + j">Date</label>
            <input [id]="'cf-o-date-' + j" type="date" formControlName="date" [attr.aria-invalid]="invalid(oneOffDraft.controls.date)" />
          </div>
        </div>
        <div class="actions">
          <button class="button" type="submit">{{ j < form.controls.oneOffs.length ? 'Enregistrer la ponctuelle' : 'Ajouter la ponctuelle' }}</button>
          <button class="button button-secondary" type="button" (click)="oneOffDialog.close()">Annuler</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    // Lignes compactes groupées (comme les récurrences) : une surface, filet entre les lignes.
    .rows,
    .sim-rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
      &:has(> .empty) {
        background: none;
        border: 0;
        box-shadow: none;
      }
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      padding: var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
    }
    .row-main {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: var(--text-sm);
    }
    .row-title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2);
      font-size: var(--text-base);
    }
    .empty {
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }

    // Paramètres puis résultat ; côte à côte quand la page a la place (bureau).
    .layout {
      display: grid;
      gap: 0 var(--space-5);
      align-items: start;
    }
    @container (min-width: 56rem) {
      .row {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }
      .layout {
        grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
      }
    }
    .params h2 {
      margin-bottom: var(--space-2);
    }

    // Assistant : étapes librement accessibles, l'étape en cours pleine primaire.
    .steps {
      display: grid;
      grid-auto-columns: 1fr;
      grid-auto-flow: column;
      gap: var(--space-1);
      list-style: none;
      margin: 0;
      padding: 0;
      button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        width: 100%;
        min-height: var(--tap);
        padding: var(--space-1);
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius);
        background: var(--color-surface);
        color: var(--color-text);
        font: inherit;
        font-size: var(--text-sm);
        cursor: pointer;
        &:hover:not([aria-current]) {
          background: var(--color-surface-2);
        }
        &[aria-current] {
          border-color: var(--color-primary);
          background: var(--color-primary);
          color: var(--color-on-primary);
          font-weight: var(--weight-bold);
        }
      }
    }
    .step-num {
      display: inline-grid;
      place-items: center;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: var(--radius-pill);
      border: 1px solid currentColor;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
    .step {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
      animation: enter-up var(--duration) var(--ease-out);
      &[hidden] {
        display: none;
      }
      h3 {
        margin: 0;
      }
      h4 {
        margin: var(--space-2) 0 0;
        font-size: var(--text-sm);
      }
    }
    .step-nav .button:not(.button-secondary) {
      margin-left: auto;
    }
    .save {
      display: grid;
      gap: var(--space-2);
      padding-top: var(--space-3);
      border-top: 1px solid var(--color-border);
    }

    // Récurrence cochable / ligne simulée : nom et montant sur une ligne, détail atténué dessous.
    .field .pick,
    .sim-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      column-gap: var(--space-2);
      align-items: baseline;
      overflow-wrap: anywhere;
    }
    .sim-row {
      grid-template-columns: minmax(0, 1fr) auto;
      padding: var(--space-2) 0;
      + .sim-row {
        border-top: 1px solid var(--color-border);
      }
    }
    .pick-meta {
      grid-column: 2 / -1;
      font-size: var(--text-sm);
    }
    .sim-row .pick-meta,
    .sim-row .actions {
      grid-column: 1 / -1;
    }
    .sim-row .link-button {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap);
    }
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--space-3);
      align-items: start;
    }

    // Résultat : grand chiffre, cartes chiffrées, enveloppe, courbe, tableaux.
    .appear {
      animation: enter-up var(--duration-slow) var(--ease-out);
    }
    .end {
      display: grid;
      margin: 0 0 var(--space-3);
    }
    .end-label {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
    }
    .end-value {
      font-size: var(--text-3xl);
      line-height: var(--leading-tight);
      letter-spacing: -0.01em;
    }
    .stat-grid {
      margin-bottom: var(--space-3);
    }
    .envelope {
      margin-bottom: var(--space-3);
      h3 {
        margin: 0 0 var(--space-2);
      }
      .hint {
        margin: var(--space-2) 0 0;
        font-size: var(--text-sm);
      }
    }
    .gauge-caption {
      margin: var(--space-1) 0 var(--space-2);
      font-size: var(--text-sm);
    }
    .allowance {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-1) var(--space-3);
      align-items: baseline;
      margin: 0;
      font-size: var(--text-sm);
      dd {
        margin: 0;
      }
    }
    .daily {
      margin-bottom: var(--space-3);
      summary {
        display: flex;
        align-items: center;
        min-height: var(--tap);
        font-weight: var(--weight-bold);
        cursor: pointer;
      }
    }
    tbody th {
      font-weight: var(--weight-regular);
    }
    .excluded {
      color: var(--color-text-muted);
      text-decoration: line-through;
    }
  `,
})
export class CashflowPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly injector = inject(Injector);

  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly units = UNIT_LABELS;
  protected readonly unitValues = Object.values(IntervalUnit);
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly periodLabels = PERIOD_LABELS;
  protected readonly limits = CASHFLOW_LIMITS;
  protected readonly todayDate = today();
  protected readonly day = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));
  /** Montant signé d'affichage (« −12,34 € » / « +12,34 € »). */
  protected readonly signed = (type: TransactionType, cents: number) => (type === TransactionType.CREDIT ? cents : -cents);
  protected readonly cents = (euros: string) => eurosToCents(euros) ?? 0;

  /** Assistant : étapes librement accessibles ; tout reste dans le même formulaire. */
  protected readonly steps = ['Période', 'Mouvements', 'Plancher'];
  protected readonly step = signal(0);

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
  /** Part de l'enveloppe qui reste à dépenser (jauge), 0 à 100. */
  protected readonly remainingPct = computed(() => {
    const a = this.result()?.allowance;
    return a && a.periodCents > 0 ? Math.round(Math.min(100, Math.max(0, (a.remainingCents * 100) / a.periodCents))) : 0;
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

  /** Ligne simulée éditée dans sa modale : index dans la liste (= longueur pour un ajout) et brouillon. */
  protected readonly extraIndex = signal(0);
  protected readonly extraDraft = this.extraGroup();
  protected readonly oneOffIndex = signal(0);
  protected readonly oneOffDraft = this.oneOffGroup();
  /** Paramètres du dernier calcul lancé : un recalcul automatique n'a lieu que s'ils ont changé. */
  private sent = '';

  constructor() {
    forkJoin([this.api.get<AccountDto[]>('/accounts'), this.api.get<RecurrenceDto[]>('/recurrences')]).subscribe({
      next: ([accounts, recurrences]) => {
        this.accounts.set(accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED));
        this.allRecurrences.set(recurrences);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
    this.reload();
    // Un résultat affiché suit les paramètres, dès qu'ils sont valides.
    this.form.valueChanges.pipe(debounceTime(RECALC_DELAY_MS), takeUntilDestroyed()).subscribe(() => {
      if (this.result() && this.form.valid && JSON.stringify(this.form.getRawValue()) !== this.sent) this.calculate();
    });
  }

  protected goTo(i: number): void {
    this.step.set(i);
    afterNextRender(() => document.getElementById(`cf-step-${i}`)?.focus(), { injector: this.injector });
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

  protected editExtra(dialog: HTMLDialogElement, i: number): void {
    const list = this.form.controls.extras;
    this.extraIndex.set(i);
    this.extraDraft.reset((i < list.length ? list.at(i) : this.extraGroup()).getRawValue());
    dialog.showModal();
  }

  protected keepExtra(dialog: HTMLDialogElement): void {
    if (this.extraDraft.invalid) return this.extraDraft.markAllAsTouched();
    const g = this.extraGroup();
    g.setValue(this.extraDraft.getRawValue());
    const list = this.form.controls.extras;
    if (this.extraIndex() < list.length) list.setControl(this.extraIndex(), g);
    else list.push(g);
    dialog.close();
  }

  protected editOneOff(dialog: HTMLDialogElement, i: number): void {
    const list = this.form.controls.oneOffs;
    this.oneOffIndex.set(i);
    this.oneOffDraft.reset((i < list.length ? list.at(i) : this.oneOffGroup()).getRawValue());
    dialog.showModal();
  }

  protected keepOneOff(dialog: HTMLDialogElement): void {
    if (this.oneOffDraft.invalid) return this.oneOffDraft.markAllAsTouched();
    const g = this.oneOffGroup();
    g.setValue(this.oneOffDraft.getRawValue());
    const list = this.form.controls.oneOffs;
    if (this.oneOffIndex() < list.length) list.setControl(this.oneOffIndex(), g);
    else list.push(g);
    dialog.close();
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
      // Ramène l'assistant à l'étape à compléter (les lignes simulées sont validées dans leur modale).
      const c = this.form.controls;
      this.step.set(!this.accountIds().length || c.startDate.invalid || c.endDate.invalid ? 0 : 2);
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
    this.sent = JSON.stringify(this.form.getRawValue());
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
    this.sent = JSON.stringify(this.form.getRawValue());
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
