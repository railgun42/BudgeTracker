import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AccountDto,
  addDays,
  addMonths,
  CategoryDto,
  centsToEuros,
  CreateRecurrenceInput,
  eurosToCents,
  IntervalUnit,
  LocalDate,
  RecurrenceDto,
  RecurrenceUpdateScope,
  TransactionTemplateInput,
  TransactionType,
  UpdateRecurrenceInput,
} from '@budgetracker/shared';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { amountValidator, SignedEurPipe } from '../../core/money';
import { today } from '../../core/today';
import { categoryLabel, categoryOptions, NO_CATEGORY_LABEL, UNIT_LABELS } from '../../shared-ui/labels';
import { UndoBanner } from '../../shared-ui/undo-banner';
import { errorMessage } from '../auth/auth-form';

// Affichage seulement : les dates restent 'YYYY-MM-DD' ; lues en UTC pour ne jamais changer de jour (comme l'historique).
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

// « Tous les mois », « Toutes les 2 semaines »…
const EVERY: Record<IntervalUnit, [one: string, many: string]> = {
  [IntervalUnit.DAY]: ['Tous les jours', 'Tous les {n} jours'],
  [IntervalUnit.WEEK]: ['Toutes les semaines', 'Toutes les {n} semaines'],
  [IntervalUnit.MONTH]: ['Tous les mois', 'Tous les {n} mois'],
  [IntervalUnit.YEAR]: ['Tous les ans', 'Tous les {n} ans'],
};

/** « Tous les mois depuis le 31 janv. 2026 jusqu'au 31 déc. 2026 » ; « à partir du » si la première échéance est à venir. */
export function frequencyLabel(r: RecurrenceDto, day: LocalDate): string {
  const [one, many] = EVERY[r.unit];
  const every = r.interval === 1 ? one : many.replace('{n}', String(r.interval));
  const since = r.startDate > day ? 'à partir du' : 'depuis le';
  return `${every} ${since} ${dayLabel(r.startDate)}` + (r.endDate ? ` jusqu'au ${dayLabel(r.endDate)}` : '');
}

/**
 * Prochaine échéance après `day` (celles jusqu'à ce jour sont déjà générées par le serveur), null si la récurrence est terminée.
 * Même ancrage que le serveur (apps/api/src/recurrences/engine) : la k-ième échéance part de startDate (31/01 → 28/02 → 31/03).
 */
export function nextDue(r: RecurrenceDto, day: LocalDate): LocalDate | null {
  // ponytail: parcours depuis k = 0 ; quelques milliers de tours au pire pour une règle quotidienne ancienne.
  for (let k = 0; ; k++) {
    const n = k * r.interval;
    const d =
      r.unit === IntervalUnit.MONTH
        ? addMonths(r.startDate, n)
        : r.unit === IntervalUnit.YEAR
          ? addMonths(r.startDate, 12 * n)
          : addDays(r.startDate, r.unit === IntervalUnit.WEEK ? 7 * n : n);
    if (d > day) return r.endDate && d > r.endDate ? null : d;
  }
}

// Nombre moyen d'échéances par mois pour un intervalle de 1 (estimation du total mensuel).
const PER_MONTH: Record<IntervalUnit, number> = {
  [IntervalUnit.DAY]: 365 / 12,
  [IntervalUnit.WEEK]: 52 / 12,
  [IntervalUnit.MONTH]: 1,
  [IntervalUnit.YEAR]: 1 / 12,
};

const signed = (r: RecurrenceDto) => (r.template.type === TransactionType.CREDIT ? r.template.amountCents : -r.template.amountCents);

// Liste, création (modale), suppression avec annulation. Le serveur génère les occurrences
// jusqu'à aujourd'hui ; elles apparaissent ensuite dans l'historique comme des transactions ordinaires.
@Component({
  selector: 'app-recurrences-page',
  imports: [ReactiveFormsModule, SignedEurPipe, UndoBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <h1>Récurrences</h1>
      <button type="button" class="button" (click)="dialog.showModal()">Nouvelle récurrence</button>
    </div>

    @if (undoable(); as deleted) {
      <app-undo-banner [message]="'Récurrence « ' + (deleted.template.name || 'sans libellé') + ' » supprimée.'" (undo)="restore(deleted)" />
    }
    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }

    @if (recurrences().length) {
      <p class="card summary">
        <span class="summary-label">Solde mensuel estimé </span>
        <span class="balance" [class.credit]="monthlyCents() > 0" [class.debit]="monthlyCents() < 0">{{ monthlyCents() | signedEur }}</span>
        <span class="muted"> Revenus moins dépenses des récurrences en cours, ramenés à un mois.</span>
      </p>
    }

    <ul class="rows" aria-label="Récurrences">
      @for (g of groups(); track g.label) {
        <li>
          <h2 class="group-head">{{ g.label }}</h2>
          <ul class="group-rows">
            @for (row of g.rows; track row.r.id) {
              <li class="row">
                <div class="row-main">
                  <span class="row-title">
                    <span class="category-dot" aria-hidden="true" [style.background-color]="row.color"></span>
                    <strong>{{ row.r.template.name || 'Sans libellé' }}</strong>
                  </span>
                  <span>{{ row.frequency }}</span>
                  <span class="muted">{{ accountName(row.r.accountId) }} · {{ row.category }}</span>
                  <span class="muted">
                    @if (row.next) {
                      Prochaine échéance : {{ row.next }}
                    } @else {
                      Terminée
                    }
                  </span>
                </div>
                <span class="amount" [class.credit]="row.cents > 0" [class.debit]="row.cents < 0">{{ row.cents | signedEur }}</span>
                <div class="actions">
                  <button type="button" class="button button-secondary" (click)="edit(row.r)">
                    Modifier<span class="visually-hidden"> {{ row.r.template.name }}</span>
                  </button>
                  <button type="button" class="button button-secondary" (click)="remove(row.r)">
                    Supprimer<span class="visually-hidden"> {{ row.r.template.name }}</span>
                  </button>
                </div>
              </li>
            }
          </ul>
        </li>
      } @empty {
        <li class="empty muted">Aucune récurrence. Créez-en une avec « Nouvelle récurrence ».</li>
      }
    </ul>

    <!-- Modale native (Échap, focus piégé, voile) ; la page derrière est inerte, d'où l'erreur répétée dedans. -->
    <dialog #dialog class="modal" aria-labelledby="rec-dialog-title" (close)="closed()">
      <h2 id="rec-dialog-title">{{ editing() ? 'Modifier la récurrence' : 'Nouvelle récurrence' }}</h2>
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <fieldset class="field">
          <legend>Sens</legend>
          <div id="rec-type" class="segmented">
            <button type="button" [attr.aria-pressed]="form.controls.type.value === DEBIT" (click)="form.controls.type.setValue(DEBIT)">
              Dépense
            </button>
            <button type="button" [attr.aria-pressed]="form.controls.type.value === CREDIT" (click)="form.controls.type.setValue(CREDIT)">
              Revenu
            </button>
          </div>
        </fieldset>
        <div class="field">
          <label for="rec-amount">Montant (€)</label>
          <!-- Signe selon le sens : la couleur ne porte jamais seule l'information. -->
          <div class="amount-input">
            @if (form.controls.type.value === CREDIT) {
              <span class="amount-sign credit" aria-hidden="true">+</span>
            } @else {
              <span class="amount-sign debit" aria-hidden="true">−</span>
            }
            <input
              id="rec-amount"
              formControlName="amount"
              inputmode="decimal"
              autocomplete="off"
              [attr.aria-invalid]="invalid('amount')"
              aria-describedby="rec-amount-hint"
            />
          </div>
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
        @if (editing(); as r) {
          <!-- Non modifiables (SPEC §3.6) : rappelés pour situer la récurrence. -->
          <p class="muted">
            {{ accountName(r.accountId) }} · {{ frequency(r) }}. Le compte, la fréquence et la première échéance ne se modifient pas.
          </p>
        } @else {
          <div class="field">
            <label for="rec-account">Compte</label>
            <select id="rec-account" formControlName="accountId" [attr.aria-invalid]="invalid('accountId')">
              <option value="">Choisir un compte</option>
              @for (a of accounts(); track a.id) {
                <option [value]="a.id">{{ a.name }}</option>
              }
            </select>
          </div>
          <div class="pair">
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
          </div>
        }
        <div class="pair">
          @if (!editing()) {
            <div class="field">
              <label for="rec-start">Première échéance</label>
              <input id="rec-start" type="date" formControlName="startDate" />
            </div>
          }
          <div class="field">
            <label for="rec-end">Dernière échéance (facultatif)</label>
            <input id="rec-end" type="date" formControlName="endDate" />
          </div>
        </div>
        <div class="field">
          <label for="rec-name">Libellé</label>
          <input id="rec-name" formControlName="name" maxlength="100" autocomplete="off" />
        </div>
        @if (askScope()) {
          <!-- Question posée à l'enregistrement d'une modification, s'il existe déjà des échéances passées. -->
          <div #scopeQuestion class="field question" role="group" aria-labelledby="rec-scope-title" aria-describedby="rec-scope-hint" tabindex="-1">
            <p id="rec-scope-title" class="scope-title">Appliquer la modification aussi aux échéances déjà passées ?</p>
            <p id="rec-scope-hint" class="field-hint">
              Les échéances passées sont dans l'historique. Si vous les modifiez aussi, leurs retouches faites une à une sur les mêmes champs
              seront remplacées ; les échéances supprimées le restent.
            </p>
            <div class="actions">
              <button class="button" type="button" [disabled]="pending()" (click)="save('future')">Prochaines échéances seulement</button>
              <button class="button button-secondary" type="button" [disabled]="pending()" (click)="save('all')">Aussi les précédentes</button>
              <button class="link-button" type="button" (click)="askScope.set(false)">Revenir au formulaire</button>
            </div>
          </div>
        } @else {
          <div class="actions">
            <button class="button" type="submit" [disabled]="pending()">{{ editing() ? 'Enregistrer' : 'Créer la récurrence' }}</button>
            <button class="button button-secondary" type="button" (click)="dialog.close()">Annuler</button>
          </div>
        }
      </form>
    </dialog>
  `,
  // Mise en page seulement : boutons, champs, bandeaux, modale et pastilles viennent de la charte (styles.scss).
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
    .summary {
      display: grid;
      gap: var(--space-1);
      margin: 0 0 var(--space-4);
      .muted {
        font-size: var(--text-sm);
      }
    }
    .summary-label {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
    }
    .rows,
    .group-rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows {
      display: grid;
      gap: var(--space-4);
    }
    .group-head {
      margin: 0 0 var(--space-2);
      font-size: var(--text-base);
    }
    // Une surface par groupe, lignes séparées par un filet (comme l'historique).
    .group-rows {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-1);
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2) var(--space-3);
      align-items: start;
      padding: var(--space-3);
      + .row {
        border-top: 1px solid var(--color-border);
      }
      > .actions {
        grid-column: 1 / -1;
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
      align-items: baseline;
      gap: var(--space-2);
      font-size: var(--text-base);
    }
    @media (min-width: 768px) {
      .row {
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        > .actions {
          grid-row: 1;
          grid-column: 3;
        }
      }
    }
    .empty {
      padding: var(--space-4);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      text-align: center;
    }
    .scope-title {
      margin: 0;
      font-weight: var(--weight-bold);
    }
    // Deux champs côte à côte, empilés s'ils n'ont pas la place (modale à 360 px).
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      gap: var(--space-3);
      align-items: end;
    }
  `,
})
export class RecurrencesPage {
  private readonly api = inject(ApiClient);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly scopeQuestion = viewChild<ElementRef<HTMLElement>>('scopeQuestion');

  protected readonly DEBIT = TransactionType.DEBIT;
  protected readonly CREDIT = TransactionType.CREDIT;
  protected readonly units = UNIT_LABELS;
  protected readonly unitValues = Object.values(IntervalUnit);

  protected readonly recurrences = signal<RecurrenceDto[]>([]);
  protected readonly accounts = signal<AccountDto[]>([]);
  private readonly allCategories = signal<CategoryDto[]>([]);
  private readonly categoryById = computed(() => new Map(this.allCategories().map((c) => [c.id, c])));
  protected readonly categories = computed(() => categoryOptions(this.allCategories(), null));
  protected readonly undoable = signal<RecurrenceDto | null>(null);
  /** Récurrence en cours de modification ; null ⇒ création. */
  protected readonly editing = signal<RecurrenceDto | null>(null);
  protected readonly askScope = signal(false);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Lignes d'affichage, revenus puis dépenses (groupe vide masqué). */
  protected readonly groups = computed(() => {
    const day = today();
    const rows = this.recurrences().map((r) => {
      const c = r.template.categoryId ? this.categoryById().get(r.template.categoryId) : undefined;
      const next = nextDue(r, day);
      return {
        r,
        cents: signed(r),
        frequency: frequencyLabel(r, day),
        next: next && dayLabel(next),
        category: c ? categoryLabel(c) : NO_CATEGORY_LABEL,
        // Couleur de la catégorie, sinon de son parent ; null ⇒ pastille neutre (styles.scss).
        color: c?.color ?? (c?.parentId ? this.categoryById().get(c.parentId)?.color : null) ?? null,
      };
    });
    return [
      { label: 'Revenus', rows: rows.filter((x) => x.cents > 0) },
      { label: 'Dépenses', rows: rows.filter((x) => x.cents < 0) },
    ].filter((g) => g.rows.length);
  });
  /** Revenus − dépenses des récurrences non terminées, ramenés à un mois moyen (estimation). */
  protected readonly monthlyCents = computed(() => {
    const day = today();
    return Math.round(
      this.recurrences()
        .filter((r) => nextDue(r, day))
        .reduce((sum, r) => sum + (signed(r) * PER_MONTH[r.unit]) / r.interval, 0),
    );
  });

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

  protected frequency(r: RecurrenceDto): string {
    return frequencyLabel(r, today());
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

  /** Ouvre la modale préremplie ; catégorie la plus précise ⇒ parent + sous-catégorie. */
  protected edit(r: RecurrenceDto): void {
    const c = r.template.categoryId ? this.categoryById().get(r.template.categoryId) : undefined;
    this.form.reset({
      amount: centsToEuros(r.template.amountCents),
      categoryId: c?.parentId ?? c?.id ?? '',
      subcategoryId: c?.parentId ? c.id : '',
      accountId: r.accountId,
      type: r.template.type,
      interval: r.interval,
      unit: r.unit,
      startDate: r.startDate,
      endDate: r.endDate ?? '',
      name: r.template.name,
    });
    this.editing.set(r);
    this.error.set(null);
    this.dialog().nativeElement.showModal();
  }

  // Événement `close` de la modale (Échap, Annuler, succès).
  protected closed(): void {
    this.form.reset();
    this.editing.set(null);
    this.askScope.set(false);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const r = this.editing();
    if (r) {
      // Des échéances sont déjà générées (jusqu'à aujourd'hui) ⇒ on demande si elles suivent la modification.
      if (r.startDate > today()) {
        this.save('future');
      } else {
        this.askScope.set(true);
        afterNextRender(() => this.scopeQuestion()?.nativeElement.focus(), { injector: this.injector });
      }
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
        this.dialog().nativeElement.close();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 404: 'Ce compte ou cette catégorie n’existe plus.', 422: 'Récurrence refusée : vérifiez les dates et le compte.' }));
      },
    });
  }

  /** PATCH des seuls champs changés : avec scope 'all', un champ non touché ne remplace pas les retouches du passé. */
  protected save(scope: RecurrenceUpdateScope): void {
    const r = this.editing()!;
    const { amount, categoryId, subcategoryId, type, endDate, name } = this.form.getRawValue();
    const template: Partial<TransactionTemplateInput> = {};
    const amountCents = eurosToCents(amount)!;
    if (amountCents !== r.template.amountCents) template.amountCents = amountCents;
    if (type !== r.template.type) template.type = type;
    if (name.trim() !== r.template.name) template.name = name.trim();
    if (((categoryId && subcategoryId) || categoryId || null) !== r.template.categoryId) {
      template.categoryId = categoryId || null;
      if (categoryId && subcategoryId) template.subcategoryId = subcategoryId;
    }
    const body: UpdateRecurrenceInput = {
      version: r.version,
      scope,
      ...((endDate || null) !== r.endDate ? { endDate: endDate || null } : {}),
      ...(Object.keys(template).length ? { template } : {}),
    };
    this.pending.set(true);
    this.error.set(null);
    this.api.patch<RecurrenceDto>(`/recurrences/${r.id}`, body).subscribe({
      next: () => {
        this.pending.set(false);
        this.dialog().nativeElement.close();
        this.reload();
      },
      error: (e) => {
        this.pending.set(false);
        this.askScope.set(false);
        this.error.set(
          errorMessage(e, {
            404: 'Cette récurrence, ce compte ou cette catégorie n’existe plus.',
            409: 'Cette récurrence a été modifiée entre-temps : fermez la fenêtre et recommencez.',
            422: 'Modification refusée : vérifiez la dernière échéance et le sens.',
          }),
        );
        if (e?.status === 409) this.reload();
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
