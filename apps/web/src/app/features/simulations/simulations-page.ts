import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AccountDto,
  CategoryDto,
  centsToEuros,
  CreateScenarioInput,
  eurosToCents,
  formatEur,
  SCENARIO_LIMITS,
  ScenarioChange,
  ScenarioChangeKind,
  ScenarioComparisonDto,
  ScenarioDto,
  TrackingType,
  UpdateScenarioInput,
} from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, EurPipe } from '../../core/money';
import { categoryLabel } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';
import { ProjectionChart } from './projection-chart';

export const KIND_LABELS: Record<ScenarioChangeKind, string> = {
  CATEGORY: 'Dépenser plus ou moins dans une catégorie',
  SUBSCRIPTION: 'Nouvel abonnement',
  LOAN: 'Achat à crédit',
};

/** 350 → « 3,5 % ». */
const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR')} %`;

// Scénarios « et si » (SPEC §6.2) : l'API les applique à une copie virtuelle de la projection d'un compte ;
// rien n'est écrit dans les comptes. Comparaison côte à côte : courbes, puis tableau (une colonne par scénario).
@Component({
  selector: 'app-simulations-page',
  imports: [ReactiveFormsModule, RouterLink, EurPipe, ProjectionChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Simulations</h1>
    <p class="muted">Un scénario « et si » s'applique à une copie virtuelle de votre compte : vos données ne sont jamais modifiées.</p>
    <p><a routerLink="/simulations/tresorerie">Simulation de trésorerie : combien me restera-t-il au jour X ?</a></p>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    <section aria-labelledby="h-scenarios">
      <h2 id="h-scenarios">Mes scénarios</h2>
      <ul class="cards" aria-label="Scénarios">
        @for (s of scenarios(); track s.id) {
          <li class="card">
            <label class="pick">
              <input
                type="checkbox"
                [checked]="selected().includes(s.id)"
                [disabled]="!selected().includes(s.id) && selected().length >= maxCompared"
                (change)="toggle(s.id)"
              />
              <strong>{{ s.name }}</strong>
            </label>
            <ul class="changes">
              @for (c of s.params.changes; track $index) {
                <li>{{ describe(c) }}</li>
              }
            </ul>
            <div class="card-actions">
              <button type="button" class="button button-secondary" (click)="edit(s)">
                Modifier<span class="visually-hidden"> {{ s.name }}</span>
              </button>
              <button type="button" class="button button-secondary" (click)="remove(s)">
                Supprimer<span class="visually-hidden"> {{ s.name }}</span>
              </button>
            </div>
          </li>
        } @empty {
          <li class="muted">Aucun scénario.</li>
        }
      </ul>
    </section>

    <section aria-labelledby="h-compare">
      <h2 id="h-compare">Comparer</h2>
      <form class="filters" [formGroup]="compareForm" (ngSubmit)="compare()" novalidate>
        <div class="field">
          <label for="cmp-account">Compte</label>
          <select id="cmp-account" formControlName="accountId">
            <option value="">Choisir un compte</option>
            @for (a of accounts(); track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="cmp-months">Horizon (mois)</label>
          <input id="cmp-months" type="number" min="1" max="600" formControlName="months" />
        </div>
        <div class="actions">
          <button class="button" type="submit" [disabled]="pending() || compareForm.invalid || !selected().length">Comparer</button>
        </div>
      </form>
      <p class="muted">Cochez de 1 à {{ maxCompared }} scénarios.</p>

      @if (comparison(); as cmp) {
        <app-projection-chart [data]="cmp" />
        <div class="scroll">
          <table class="compare">
            <caption>
              Solde projeté (rythme moyen des dépenses : {{ cmp.baseline.averageMonthlySpendCents | eur }} par mois)
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" class="num">Sans changement</th>
                @for (s of cmp.scenarios; track s.id) {
                  <th scope="col" class="num">{{ s.name }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (p of cmp.baseline.points; track p.date; let i = $index) {
                <tr>
                  <th scope="row">{{ p.date }}</th>
                  <td class="num">{{ p.balanceCents | eur }}</td>
                  @for (s of cmp.scenarios; track s.id) {
                    <td class="num">{{ s.projection.points[i].balanceCents | eur }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <section aria-labelledby="h-new">
      <h2 id="h-new">{{ editing() ? 'Modifier « ' + editing()!.name + ' »' : 'Nouveau scénario' }}</h2>
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="sc-name">Nom</label>
          <input id="sc-name" formControlName="name" maxlength="100" autocomplete="off" [attr.aria-invalid]="form.controls.name.invalid && form.controls.name.touched" />
        </div>
        @for (g of form.controls.changes.controls; track g; let i = $index) {
          <fieldset [formGroup]="g">
            <legend>Modification {{ i + 1 }}</legend>
            <div class="field">
              <label [for]="'sc-kind-' + i">Type</label>
              <select [id]="'sc-kind-' + i" formControlName="kind">
                @for (k of kinds; track k) {
                  <option [value]="k">{{ kindLabels[k] }}</option>
                }
              </select>
            </div>
            @if (g.controls.kind.value === 'CATEGORY') {
              <div class="field">
                <label [for]="'sc-category-' + i">Catégorie</label>
                <select [id]="'sc-category-' + i" formControlName="categoryId">
                  <option value="">Choisir une catégorie</option>
                  @for (c of categories(); track c.id) {
                    <option [value]="c.id">{{ c.label }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label [for]="'sc-direction-' + i">Sens</label>
                <select [id]="'sc-direction-' + i" formControlName="direction">
                  <option value="less">Dépenser moins</option>
                  <option value="more">Dépenser plus</option>
                </select>
              </div>
            }
            <div class="field">
              <label [for]="'sc-amount-' + i">{{ g.controls.kind.value === 'LOAN' ? 'Montant emprunté (€)' : 'Montant par mois (€)' }}</label>
              <input
                [id]="'sc-amount-' + i"
                formControlName="amount"
                inputmode="decimal"
                autocomplete="off"
                [attr.aria-invalid]="g.controls.amount.invalid && g.controls.amount.touched"
              />
            </div>
            @if (g.controls.kind.value === 'LOAN') {
              <div class="field">
                <label [for]="'sc-rate-' + i">Taux annuel (%)</label>
                <input [id]="'sc-rate-' + i" formControlName="rate" inputmode="decimal" autocomplete="off" />
              </div>
              <div class="field">
                <label [for]="'sc-months-' + i">Durée (mois)</label>
                <input [id]="'sc-months-' + i" type="number" min="1" max="600" formControlName="months" />
              </div>
            }
            @if (form.controls.changes.length > 1) {
              <button type="button" class="link-button" (click)="removeChange(i)">Retirer la modification {{ i + 1 }}</button>
            }
          </fieldset>
        }
        @if (form.controls.changes.length < maxChanges) {
          <button type="button" class="button button-secondary" (click)="addChange()">Ajouter une modification</button>
        }
        <div class="card-actions">
          <button class="button" type="submit" [disabled]="pending()">{{ editing() ? 'Enregistrer les modifications' : 'Enregistrer le scénario' }}</button>
          @if (editing()) {
            <button type="button" class="button button-secondary" (click)="resetForm()">Annuler la modification</button>
          }
        </div>
      </form>
    </section>
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
    }
    .pick {
      display: flex;
      gap: var(--space-2);
      align-items: center;
    }
    .changes {
      margin: var(--space-2) 0;
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-2);
      align-items: end;
    }
    fieldset {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      display: grid;
      gap: var(--space-2);
    }
    .scroll {
      overflow-x: auto;
    }
    .compare {
      width: 100%;
      border-collapse: collapse;
      background: var(--color-surface);
    }
    .compare caption {
      text-align: left;
      padding: var(--space-2) 0;
    }
    .compare th,
    .compare td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
      white-space: nowrap;
    }
    .compare .num {
      text-align: right;
    }
    tbody th {
      font-weight: 400;
    }
  `,
})
export class SimulationsPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly kinds = Object.keys(KIND_LABELS) as ScenarioChangeKind[];
  protected readonly kindLabels = KIND_LABELS;
  protected readonly maxCompared = SCENARIO_LIMITS.maxCompared;
  protected readonly maxChanges = SCENARIO_LIMITS.maxChanges;

  protected readonly scenarios = signal<ScenarioDto[]>([]);
  // Portefeuilles exclus : pas de solde à projeter.
  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allCategories = signal<CategoryDto[]>([]);
  protected readonly categories = computed(() =>
    this.allCategories()
      .map((c) => ({ id: c.id, label: categoryLabel(c) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  );
  protected readonly selected = signal<string[]>([]);
  protected readonly comparison = signal<ScenarioComparisonDto | null>(null);
  /** Scénario en cours de modification (formulaire prérempli) ; null ⇒ création. */
  protected readonly editing = signal<ScenarioDto | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly compareForm = this.fb.group({
    accountId: ['', Validators.required],
    months: [12, [Validators.required, Validators.min(1), Validators.max(600)]],
  });
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    changes: this.fb.array([this.newChange()]),
  });

  constructor() {
    forkJoin([this.api.get<AccountDto[]>('/accounts'), this.api.get<CategoryDto[]>('/categories')]).subscribe({
      next: ([accounts, categories]) => {
        this.accounts.set(accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED));
        this.allCategories.set(categories);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
    this.reload();
  }

  /** Groupe de saisie d'une modification, vide ou prérempli depuis un scénario existant. */
  private newChange(c?: ScenarioChange) {
    const cents = !c ? null : c.kind === 'CATEGORY' ? Math.abs(c.monthlyDeltaCents) : c.kind === 'SUBSCRIPTION' ? c.monthlyCents : c.principalCents;
    return this.fb.group({
      kind: [c?.kind ?? ('SUBSCRIPTION' as ScenarioChangeKind)],
      categoryId: [c?.kind === 'CATEGORY' ? c.categoryId : ''],
      direction: [(c?.kind === 'CATEGORY' && c.monthlyDeltaCents > 0 ? 'more' : 'less') as 'less' | 'more'],
      amount: [cents === null ? '' : centsToEuros(cents), [Validators.required, amountValidator]],
      // Taux à 2 décimales, même format que les montants : 350 points de base ⇒ « 3,50 ».
      rate: [c?.kind === 'LOAN' ? centsToEuros(c.annualRateBp) : '0'],
      months: [c?.kind === 'LOAN' ? c.months : 12],
    });
  }

  protected edit(s: ScenarioDto): void {
    this.editing.set(s);
    this.error.set(null);
    this.form.controls.changes.clear();
    s.params.changes.forEach((c) => this.form.controls.changes.push(this.newChange(c)));
    this.form.controls.name.setValue(s.name);
    document.getElementById('sc-name')?.focus();
  }

  protected resetForm(): void {
    this.editing.set(null);
    this.form.reset();
    this.form.controls.changes.clear();
    this.addChange();
  }

  /** Une comparaison affichée qui inclut ce scénario n'est plus à jour. */
  private dropStale(id: string): void {
    if (this.comparison()?.scenarios.some((s) => s.id === id)) this.comparison.set(null);
  }

  protected addChange(): void {
    this.form.controls.changes.push(this.newChange());
  }

  protected removeChange(i: number): void {
    this.form.controls.changes.removeAt(i);
  }

  protected describe(c: ScenarioChange): string {
    switch (c.kind) {
      case 'CATEGORY': {
        const label = this.categories().find((cat) => cat.id === c.categoryId)?.label ?? 'Catégorie';
        return `${label} : ${c.monthlyDeltaCents < 0 ? '−' : '+'}${formatEur(Math.abs(c.monthlyDeltaCents))} par mois`;
      }
      case 'SUBSCRIPTION':
        return `Abonnement : ${formatEur(c.monthlyCents)} par mois`;
      case 'LOAN':
        return `Crédit : ${formatEur(c.principalCents)} à ${percent(c.annualRateBp)} sur ${c.months} mois`;
    }
  }

  protected toggle(id: string): void {
    this.selected.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  private reload(): void {
    this.api.get<ScenarioDto[]>('/scenarios').subscribe({
      next: (list) => {
        this.scenarios.set(list);
        this.selected.update((ids) => ids.filter((id) => list.some((s) => s.id === id)));
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  /** Modification saisie ⇒ paramètre d'API, ou null si incomplète. */
  private toChange(g: FormGroup): ScenarioChange | null {
    const { kind, categoryId, direction, amount, rate, months } = g.getRawValue();
    const cents = eurosToCents(amount);
    if (cents === null || cents <= 0) return null;
    switch (kind as ScenarioChangeKind) {
      case 'CATEGORY':
        return categoryId ? { kind: 'CATEGORY', categoryId, monthlyDeltaCents: direction === 'less' ? -cents : cents } : null;
      case 'SUBSCRIPTION':
        return { kind: 'SUBSCRIPTION', monthlyCents: cents };
      case 'LOAN': {
        // Taux à 2 décimales, même format que les montants : « 3,5 » ⇒ 350 points de base.
        const annualRateBp = eurosToCents(String(rate));
        const n = Number(months);
        return annualRateBp !== null && annualRateBp >= 0 && Number.isInteger(n) && n >= 1 && n <= 600
          ? { kind: 'LOAN', principalCents: cents, annualRateBp, months: n }
          : null;
      }
    }
  }

  protected submit(): void {
    const changes = this.form.controls.changes.controls.map((g) => this.toChange(g));
    if (this.form.invalid || changes.includes(null)) {
      this.form.markAllAsTouched();
      this.error.set('Complétez le nom et chaque modification (montants positifs, ex. 12,34).');
      return;
    }
    const body: CreateScenarioInput = { name: this.form.controls.name.value.trim(), params: { changes: changes as ScenarioChange[] } };
    const editing = this.editing();
    const request = editing
      ? this.api.patch<ScenarioDto>(`/scenarios/${editing.id}`, { version: editing.version, ...body } satisfies UpdateScenarioInput)
      : this.api.post<ScenarioDto>('/scenarios', body);
    this.pending.set(true);
    this.error.set(null);
    request.subscribe({
      next: (saved) => {
        this.pending.set(false);
        this.dropStale(saved.id);
        this.resetForm();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            400: 'Scénario refusé : vérifiez les montants, le taux et la durée.',
            404: editing ? 'Ce scénario ou cette catégorie n’existe plus. Rechargez la page.' : 'Cette catégorie n’existe plus.',
            409: 'Ce scénario a été modifié entre-temps. Rechargez la page pour repartir de sa dernière version.',
          }),
        );
      },
    });
  }

  protected remove(s: ScenarioDto): void {
    this.api.delete(`/scenarios/${s.id}`).subscribe({
      next: () => {
        if (this.editing()?.id === s.id) this.resetForm();
        this.dropStale(s.id);
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e, { 404: 'Ce scénario n’existe plus.' })),
    });
  }

  protected compare(): void {
    const { accountId, months } = this.compareForm.getRawValue();
    this.pending.set(true);
    this.error.set(null);
    this.api.get<ScenarioComparisonDto>('/scenarios/compare', { accountId, months, ids: this.selected().join(',') }).subscribe({
      next: (cmp) => {
        this.pending.set(false);
        this.comparison.set(cmp);
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 400: 'Horizon invalide (1 à 600 mois).', 404: 'Ce compte ou ce scénario n’existe plus. Rechargez la page.' }));
      },
    });
  }
}
