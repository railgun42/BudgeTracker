import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormRecord, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AccountBalanceDto,
  AccountDto,
  BalanceSeriesDto,
  CashflowDto,
  CashflowSimulationDto,
  CategoryDto,
  CategoryStatDto,
  DashboardBlock,
  DashboardPeriod,
  DashboardPreferencesDto,
  InterestRatesDto,
  LocalDate,
  MonthlyStatDto,
  StatTotals,
  TrackingType,
  TransactionDto,
  TransactionPage,
  TransactionType,
  UpcomingOccurrenceDto,
  UpdateDashboardPreferencesInput,
} from '@budgetracker/shared';
import { catchError, concatMap, EMPTY, forkJoin, map, Observable, of, Subject, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { previousRange } from '../../core/date-range';
import { EurPipe, SignedEurPipe } from '../../core/money';
import { QuickEntry } from '../../core/quick-entry';
import { today } from '../../core/today';
import { transactionIcon } from '../../shared-ui/category-icons';
import { categoryLabel, NO_CATEGORY_LABEL } from '../../shared-ui/labels';
import { errorMessage } from '../auth/auth-form';
import { Notifications } from '../notifications/notifications';
import { DonutChart, DonutPart } from '../stats/donut-chart';
import { BalanceChart, BalanceLine } from './balance-chart';
import { BLOCK_LABELS, dashboardRange, PERIOD_LABELS } from './dashboard-period';

interface Alert {
  key: string;
  text: string;
  /** Route du lien d'action. */
  link?: { path: string; label: string };
}

interface PeriodStats {
  from: LocalDate;
  to: LocalDate;
  previous: { from: LocalDate; to: LocalDate };
  current: StatTotals;
  before: StatTotals;
  /** Totaux par catégorie de la période (donut). */
  rows: CategoryStatDto[];
}

const UPCOMING_DAYS = 7;
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const at = (fmt: Intl.DateTimeFormat, date: LocalDate) => fmt.format(new Date(`${date}T00:00:00Z`));
const sum = (rows: CategoryStatDto[]): StatTotals =>
  rows.reduce((t, r) => ({ incomeCents: t.incomeCents + r.incomeCents, expenseCents: t.expenseCents + r.expenseCents }), { incomeCents: 0, expenseCents: 0 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Tableau de bord (SPEC §7, PLAN E42b) : les chiffres viennent des endpoints existants, les préférences du serveur.
@Component({
  selector: 'app-dashboard-page',
  imports: [ReactiveFormsModule, RouterLink, EurPipe, SignedEurPipe, BalanceChart, DonutChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dash-head">
      <h1>Tableau de bord</h1>
      @if (prefs()) {
        <div class="dash-tools">
          <div class="field">
            <label for="dash-period">Période</label>
            <select id="dash-period" [formControl]="periodControl">
              @for (p of periods; track p) {
                <option [value]="p">{{ periodLabels[p] }}</option>
              }
            </select>
          </div>
          <button type="button" class="button button-secondary" aria-controls="dash-customize" [attr.aria-expanded]="customizing()" (click)="customizing.set(!customizing())">
            Personnaliser
          </button>
        </div>
      }
    </div>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        {{ error() }}
        @if (conflict()) {
          <button type="button" class="link-button" (click)="load()">Recharger</button>
        }
      </p>
    }

    <div class="dash-grid">
      <section class="dash-wide quick-actions" aria-label="Actions rapides">
        <button type="button" class="button" (click)="quick.open.set('transaction')">+ Transaction</button>
        <button type="button" class="button button-secondary" (click)="quick.open.set('transfer')">Virement</button>
      </section>

      @if (alerts().length) {
        <section class="dash-wide" aria-labelledby="h-alerts">
          <h2 id="h-alerts" class="visually-hidden">Alertes</h2>
          <ul class="alerts">
            @for (a of alerts(); track a.key) {
              <li class="alert alert-warning">
                <span>{{ a.text }}</span>
                @if (a.link; as l) {
                  <a [routerLink]="l.path">{{ l.label }}</a>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (customizing() && prefs()) {
        <section id="dash-customize" class="dash-wide card" aria-labelledby="h-custom">
          <h2 id="h-custom">Personnaliser</h2>
          <form [formGroup]="customForm" class="custom-form">
            <fieldset class="field" formGroupName="accounts">
              <legend>Comptes affichés dans les chiffres clés</legend>
              @for (a of tracked(); track a.id) {
                <label class="checkbox"><input type="checkbox" [formControlName]="a.id" /> {{ a.name }}</label>
              } @empty {
                <p class="muted">Aucun compte suivi.</p>
              }
            </fieldset>
            <fieldset class="field" formGroupName="blocks">
              <legend>Blocs affichés</legend>
              @for (b of blockKeys; track b) {
                <label class="checkbox"><input type="checkbox" [formControlName]="b" /> {{ blockLabels[b] }}</label>
              }
              <p class="field-hint">Le solde total et les alertes restent toujours affichés.</p>
            </fieldset>
          </form>
        </section>
      }

      @if (!ready()) {
        <p class="dash-wide muted" role="status">Chargement…</p>
      } @else if (!setUp()) {
        <section class="dash-wide card" aria-labelledby="h-start">
          <h2 id="h-start">Pour commencer</h2>
          <ol class="checklist">
            @for (s of steps(); track s.label) {
              <li>
                <span class="badge" [class.badge-neutral]="!s.done">{{ s.done ? 'Fait' : 'À faire' }}</span>
                @if (s.done) {
                  <span>{{ s.label }}</span>
                } @else if (s.path) {
                  <a [routerLink]="s.path">{{ s.label }}</a>
                } @else {
                  <button type="button" class="link-button" (click)="quick.open.set('transaction')">{{ s.label }}</button>
                }
              </li>
            }
          </ol>
        </section>
      } @else {
        @if (shown('KEY_FIGURES')) {
          <section aria-labelledby="h-figures">
            <h2 id="h-figures">Chiffres clés</h2>
            @if (total(); as t) {
              <ul class="stat-grid">
                <li class="card stat">
                  <p class="stat-label">Solde total</p>
                  <p class="stat-value amount" [class.negative]="t.currentCents < 0">{{ t.currentCents | eur }}</p>
                  @if (t.forecastCents !== t.currentCents) {
                    <p class="stat-hint muted">Prévisionnel : {{ t.forecastCents | eur }}</p>
                  }
                </li>
                @for (a of chosen(); track a.id) {
                  @if (balances()[a.id]; as b) {
                    <li class="card stat">
                      <p class="stat-label">{{ a.name }}</p>
                      <p class="stat-value amount" [class.negative]="b.currentCents! < 0">{{ b.currentCents | eur }}</p>
                      @if (b.forecastCents !== b.currentCents) {
                        <p class="stat-hint muted">Prévisionnel : {{ b.forecastCents | eur }}</p>
                      }
                    </li>
                  }
                }
              </ul>
            } @else {
              <p class="muted" role="status">Chargement des soldes…</p>
            }
          </section>
        }

        @if (shown('PERIOD_SUMMARY')) {
          <section aria-labelledby="h-period">
            <h2 id="h-period">{{ periodLabels[period()] }}</h2>
            @if (stats(); as s) {
              <p class="muted">Du {{ day(s.from) }} au {{ dayYear(s.to) }}</p>
              <ul class="stat-grid">
                <li class="card stat">
                  <p class="stat-label">Dépenses</p>
                  <p class="stat-value amount debit">{{ s.current.expenseCents | eur }}</p>
                  <p class="stat-hint muted">{{ s.current.expenseCents - s.before.expenseCents | signedEur }} par rapport à la période précédente</p>
                </li>
                <li class="card stat">
                  <p class="stat-label">Revenus</p>
                  <p class="stat-value amount credit">{{ s.current.incomeCents | eur }}</p>
                  <p class="stat-hint muted">{{ s.current.incomeCents - s.before.incomeCents | signedEur }} par rapport à la période précédente</p>
                </li>
                <li class="card stat">
                  <p class="stat-label">Reste</p>
                  <p class="stat-value amount" [class.credit]="rest() > 0" [class.debit]="rest() < 0">{{ rest() | signedEur }}</p>
                  <p class="stat-hint muted">{{ rest() - restBefore() | signedEur }} par rapport à la période précédente</p>
                </li>
              </ul>
              <p class="muted note">Période précédente : du {{ day(s.previous.from) }} au {{ dayYear(s.previous.to) }}. Virements entre vos comptes exclus.</p>
            } @else {
              <p class="muted" role="status">Chargement…</p>
            }
          </section>
        }

        @if (shown('BALANCE_CURVE')) {
          <section class="dash-wide card" aria-labelledby="h-curve">
            <h2 id="h-curve">Évolution du solde</h2>
            <form [formGroup]="curveForm">
              <fieldset class="field">
                <legend>Courbes affichées</legend>
                <div class="inline-checks">
                  <label class="checkbox"><input type="checkbox" formControlName="total" /> Total</label>
                  <ng-container formGroupName="accounts">
                    @for (a of tracked(); track a.id) {
                      <label class="checkbox"><input type="checkbox" [formControlName]="a.id" /> {{ a.name }}</label>
                    }
                  </ng-container>
                </div>
              </fieldset>
            </form>
            @if (curve(); as c) {
              @if (c.series.length) {
                <app-balance-chart [dates]="c.dates" [series]="c.series" />
              } @else {
                <p class="muted">Aucune courbe sélectionnée.</p>
              }
            } @else {
              <p class="muted" role="status">Chargement…</p>
            }
          </section>
        }

        @if (shown('LATEST_TRANSACTIONS')) {
          <section class="card" aria-labelledby="h-latest">
            <h2 id="h-latest">Dernières transactions</h2>
            @if (latest(); as list) {
              @if (list.length) {
                <ul class="latest">
                  @for (t of list; track t.id) {
                    <li>
                      <svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconOf(t)" /></svg>
                      <span class="latest-main">
                        <strong>{{ labelOf(t) }}</strong>
                        <span class="muted">{{ day(t.date) }} · {{ accountNames()[t.accountId] }}</span>
                      </span>
                      <span class="amount" [class.credit]="t.type === CREDIT" [class.debit]="t.type !== CREDIT">{{ (t.type === CREDIT ? t.amountCents : -t.amountCents) | signedEur }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="muted">Aucune transaction.</p>
              }
              <a routerLink="/history">Tout l’historique</a>
            } @else {
              <p class="muted" role="status">Chargement…</p>
            }
          </section>
        }

        @if (shown('CATEGORY_DONUT')) {
          <section class="card" aria-labelledby="h-donut">
            <h2 id="h-donut">Dépenses par catégorie</h2>
            @if (stats()) {
              @if (donutParts().length) {
                <app-donut-chart [parts]="donutParts()" title="Dépenses de la période" description="Dépenses par catégorie ; valeurs détaillées dans la légende">
                  <a routerLink="/stats">Voir les statistiques</a>
                </app-donut-chart>
              } @else {
                <p class="muted">Aucune dépense sur la période.</p>
                <a routerLink="/stats">Voir les statistiques</a>
              }
            } @else {
              <p class="muted" role="status">Chargement…</p>
            }
          </section>
        }
      }
    </div>
  `,
})
export class DashboardPage {
  private readonly api = inject(ApiClient);
  private readonly notifications = inject(Notifications);
  protected readonly quick = inject(QuickEntry);

  protected readonly periods = Object.keys(PERIOD_LABELS) as DashboardPeriod[];
  protected readonly periodLabels = PERIOD_LABELS;
  protected readonly blockLabels = BLOCK_LABELS;
  protected readonly blockKeys = Object.keys(BLOCK_LABELS) as DashboardBlock[];
  protected readonly CREDIT = TransactionType.CREDIT;

  protected readonly accounts = signal<AccountDto[] | null>(null);
  protected readonly prefs = signal<DashboardPreferencesDto | null>(null);
  protected readonly balances = signal<Record<string, AccountBalanceDto>>({});
  protected readonly missingRate = signal<string[]>([]);
  protected readonly stats = signal<PeriodStats | null>(null);
  protected readonly hasTransaction = signal<boolean | null>(null);
  protected readonly upcoming = signal<UpcomingOccurrenceDto[]>([]);
  protected readonly belowFloor = signal<string[]>([]);
  protected readonly series = signal<BalanceSeriesDto | null>(null);
  protected readonly latest = signal<TransactionDto[] | null>(null);
  protected readonly categories = signal<CategoryDto[]>([]);
  protected readonly customizing = signal(false);
  protected readonly error = signal('');
  protected readonly conflict = signal(false);

  protected readonly periodControl = new FormControl<DashboardPeriod>('THIS_MONTH', { nonNullable: true });
  protected readonly customForm = new FormGroup({
    accounts: new FormRecord<FormControl<boolean>>({}),
    blocks: new FormRecord<FormControl<boolean>>({}),
  });
  protected readonly curveForm = new FormGroup({
    total: new FormControl(true, { nonNullable: true }),
    accounts: new FormRecord<FormControl<boolean>>({}),
  });

  protected readonly period = computed(() => this.prefs()?.period ?? 'THIS_MONTH');
  protected readonly tracked = computed(() => (this.accounts() ?? []).filter((a) => a.trackingType !== TrackingType.NOT_TRACKED));
  /** Comptes des cartes : `null` en préférence = tous les comptes suivis. */
  protected readonly chosen = computed(() => {
    const ids = this.prefs()?.accountIds;
    return ids ? this.tracked().filter((a) => ids.includes(a.id)) : this.tracked();
  });
  /** Total de tous les comptes suivis (pas seulement ceux des cartes) ; absent tant qu'un solde manque. */
  protected readonly total = computed(() => {
    const all = this.balances();
    if (!this.tracked().every((a) => all[a.id])) return null;
    return this.tracked().reduce(
      (t, a) => ({ currentCents: t.currentCents + all[a.id].currentCents!, forecastCents: t.forecastCents + all[a.id].forecastCents! }),
      { currentCents: 0, forecastCents: 0 },
    );
  });
  protected readonly rest = computed(() => (this.stats() ? this.stats()!.current.incomeCents - this.stats()!.current.expenseCents : 0));
  protected readonly restBefore = computed(() => (this.stats() ? this.stats()!.before.incomeCents - this.stats()!.before.expenseCents : 0));

  protected readonly accountNames = computed(() => Object.fromEntries((this.accounts() ?? []).map((a) => [a.id, a.name])));
  private readonly categoryById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  /** Courbes à tracer : le total (de tous les comptes suivis) si coché, puis les comptes cochés dans l'ordre des comptes. */
  protected readonly curve = computed(() => {
    const data = this.series();
    const prefs = this.prefs();
    if (!data || !prefs) return null;
    const lines: BalanceLine[] = [];
    if (prefs.curveTotal) lines.push({ id: 'total', name: 'Total', total: true, cents: data.totalCents });
    for (const s of data.accounts) {
      if (prefs.curveAccountIds.includes(s.accountId)) lines.push({ id: s.accountId, name: this.accountNames()[s.accountId] ?? 'Compte', total: false, cents: s.balancesCents });
    }
    return { dates: data.dates, series: lines };
  });

  /** Dépenses de la période par catégorie racine (une racine additionne ses sous-catégories), décroissantes. */
  protected readonly donutParts = computed<DonutPart[]>(() => {
    const byRoot = new Map<string, DonutPart>();
    for (const row of this.stats()?.rows ?? []) {
      if (row.expenseCents <= 0) continue;
      const c = row.categoryId ? this.categoryById().get(row.categoryId) : undefined;
      const root = c?.parentId ? this.categoryById().get(c.parentId) : c;
      const key = root?.id ?? row.categoryId ?? '';
      const part = byRoot.get(key) ?? { key, label: root ? categoryLabel(root) : row.categoryId ? 'Catégorie' : NO_CATEGORY_LABEL, cents: 0 };
      part.cents += row.expenseCents;
      byRoot.set(key, part);
    }
    return [...byRoot.values()].sort((a, b) => b.cents - a.cents);
  });

  protected readonly ready = computed(() => this.accounts() !== null && this.hasTransaction() !== null && this.prefs() !== null);
  // Sans compte suivi (portefeuille seul), il n'y a pas de solde de départ à saisir.
  private readonly hasOpening = computed(() => (this.tracked().length ? this.tracked().some((a) => a.openingDate !== null) : (this.accounts()?.length ?? 0) > 0));
  protected readonly steps = computed(() => [
    { label: 'Créer un compte', done: (this.accounts()?.length ?? 0) > 0, path: '/accounts' },
    { label: 'Saisir le solde de départ', done: this.hasOpening(), path: '/accounts' },
    { label: 'Ajouter une première transaction', done: this.hasTransaction() === true, path: null },
  ]);
  protected readonly setUp = computed(() => this.steps().every((s) => s.done));

  protected readonly alerts = computed<Alert[]>(() => {
    const out: Alert[] = [];
    const names = new Map(this.tracked().map((a) => [a.id, a.name]));
    for (const id of this.missingRate()) {
      out.push({ key: `rate-${id}`, text: `Taux d’intérêt manquant pour « ${names.get(id)} » : aucun intérêt ne sera crédité au 31/12.`, link: { path: '/accounts', label: 'Définir le taux' } });
    }
    for (const a of this.tracked()) {
      const forecast = this.balances()[a.id]?.forecastCents;
      if (forecast != null && forecast < 0) out.push({ key: `negative-${a.id}`, text: `Le solde prévisionnel de « ${a.name} » est négatif.`, link: { path: '/history', label: 'Voir l’historique' } });
    }
    for (const name of this.belowFloor()) {
      out.push({ key: `floor-${name}`, text: `Simulation « ${name} » : le solde projeté passe sous le plancher.`, link: { path: '/simulations', label: 'Voir la simulation' } });
    }
    const next = this.upcoming()[0];
    if (next) {
      const n = this.upcoming().length;
      out.push({ key: 'upcoming', text: `${plural(n, 'récurrence', 'récurrences')} dans les ${UPCOMING_DAYS} prochains jours (prochaine : le ${at(DAY, next.date)}).`, link: { path: '/recurrences', label: 'Voir les récurrences' } });
    }
    const unread = this.notifications.state().unreadCount;
    if (unread > 0) out.push({ key: 'unread', text: plural(unread, 'notification non lue', 'notifications non lues') + '.', link: { path: '/notifications', label: 'Lire' } });
    return out;
  });

  /** Modifications des préférences, envoyées l'une après l'autre : chacune part de la version renvoyée par la précédente. */
  private readonly patches = new Subject<Partial<UpdateDashboardPreferencesInput>>();
  private readonly periodsToLoad = new Subject<DashboardPeriod>();

  constructor() {
    this.patches
      .pipe(
        concatMap((patch) =>
          this.api.put<DashboardPreferencesDto>('/dashboard/preferences', { ...this.prefs(), ...patch }).pipe(
            catchError((e) => (this.fail(e), EMPTY)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((saved) => {
        const periodChanged = saved.period !== this.prefs()?.period;
        this.prefs.set(saved);
        this.error.set('');
        this.conflict.set(false);
        if (periodChanged) this.periodsToLoad.next(saved.period);
      });
    this.periodsToLoad
      .pipe(switchMap((period) => this.loadStats(period)), takeUntilDestroyed())
      .subscribe((stats) => this.stats.set(stats));
    this.periodsToLoad.pipe(switchMap((period) => this.loadCurve(period)), takeUntilDestroyed()).subscribe((series) => this.series.set(series));
    this.curveForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const { total, accounts } = this.curveForm.getRawValue();
      this.patches.next({ curveTotal: total, curveAccountIds: Object.keys(accounts).filter((id) => accounts[id]) });
    });
    this.periodControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((period) => this.patches.next({ period }));
    this.customForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.patches.next(this.customized()));
    // Transaction ou virement saisi dans la modale de la coquille : chiffres relus.
    this.quick.saved.pipe(takeUntilDestroyed()).subscribe(() => this.load());
    this.load();
  }

  protected shown(block: DashboardBlock): boolean {
    return !this.prefs()?.hiddenBlocks.includes(block);
  }

  protected iconOf(t: TransactionDto): string {
    return transactionIcon(t.categoryId, this.categoryById());
  }

  protected labelOf(t: TransactionDto): string {
    const c = t.categoryId ? this.categoryById().get(t.categoryId) : undefined;
    return t.name || (c && categoryLabel(c)) || 'Transaction';
  }

  protected day = (date: LocalDate) => at(DAY, date);
  protected dayYear = (date: LocalDate) => at(DAY_YEAR, date);

  protected load(): void {
    this.error.set('');
    this.conflict.set(false);
    this.api.get<DashboardPreferencesDto>('/dashboard/preferences').subscribe({
      next: (prefs) => {
        this.prefs.set(prefs);
        this.syncForm();
        this.periodsToLoad.next(prefs.period);
      },
      error: (e) => this.fail(e),
    });
    this.api.get<MonthlyStatDto[]>('/stats/monthly').subscribe({ next: (rows) => this.hasTransaction.set(rows.length > 0), error: (e) => this.fail(e) });
    this.api.get<AccountDto[]>('/accounts').subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.balances.set({});
        this.missingRate.set([]);
        this.syncForm();
        // ponytail: un GET de solde par compte suivi (comme /accounts) ; endpoint groupé si les utilisateurs ont des dizaines de comptes.
        for (const a of this.tracked()) {
          this.api.get<AccountBalanceDto>(`/accounts/${a.id}/balance`, { today: today() }).subscribe((b) => this.balances.update((all) => ({ ...all, [a.id]: b })));
        }
        for (const a of accounts.filter((a) => a.trackingType === TrackingType.WITH_INTEREST)) {
          this.api.get<InterestRatesDto>(`/accounts/${a.id}/interest-rates`).subscribe((r) => r.missingRate && this.missingRate.update((ids) => [...ids, a.id]));
        }
      },
      error: (e) => this.fail(e),
    });
    this.api.get<UpcomingOccurrenceDto[]>('/dashboard/upcoming', { days: UPCOMING_DAYS, today: today() }).subscribe({ next: (rows) => this.upcoming.set(rows), error: (e) => this.fail(e) });
    this.api.get<TransactionPage>('/transactions', { limit: 5 }).subscribe({ next: (page) => this.latest.set(page.items), error: (e) => this.fail(e) });
    this.api.get<CategoryDto[]>('/categories').subscribe({ next: (list) => this.categories.set(list), error: (e) => this.fail(e) });
    this.loadFloorAlerts();
  }

  // Simulations sauvegardées dont le solde projeté passe sous le plancher ; une simulation terminée (422) est ignorée.
  private loadFloorAlerts(): void {
    this.api
      .get<CashflowSimulationDto[]>('/cashflow-simulations')
      .pipe(
        switchMap((sims) =>
          sims.length
            ? forkJoin(
                sims.map((s) =>
                  this.api.get<CashflowDto>(`/cashflow-simulations/${s.id}/result`, { today: today() }).pipe(
                    map((r) => (r.allowance?.belowFloor ? s.name : null)),
                    catchError(() => of(null)),
                  ),
                ),
              )
            : of([]),
        ),
      )
      .subscribe({ next: (names) => this.belowFloor.set(names.filter((n): n is string => n !== null)), error: (e) => this.fail(e) });
  }

  private loadStats(period: DashboardPeriod): Observable<PeriodStats> {
    const { from, to } = dashboardRange(period, today());
    const previous = previousRange(from, to)!;
    return forkJoin([this.api.get<CategoryStatDto[]>('/stats/by-category', { from, to }), this.api.get<CategoryStatDto[]>('/stats/by-category', previous)]).pipe(
      map(([current, before]) => ({ from, to, previous, current: sum(current), before: sum(before), rows: current })),
      catchError((e) => (this.fail(e), EMPTY)),
    );
  }

  // Passé seulement : du début de la période à aujourd'hui (la période peut finir plus tard dans le mois). Total = tous les comptes suivis.
  private loadCurve(period: DashboardPeriod): Observable<BalanceSeriesDto> {
    const now = today();
    const { from, to } = dashboardRange(period, now);
    return this.api.get<BalanceSeriesDto>('/dashboard/balance-series', { from, to: to < now ? to : now }).pipe(catchError((e) => (this.fail(e), EMPTY)));
  }

  // Cases du panneau et sélecteur de période alignés sur les préférences, sans déclencher d'enregistrement.
  private syncForm(): void {
    const prefs = this.prefs();
    if (!prefs) return;
    this.periodControl.setValue(prefs.period, { emitEvent: false });
    const { accounts, blocks } = this.customForm.controls;
    const sync = (record: FormRecord<FormControl<boolean>>, values: Record<string, boolean>) => {
      for (const key of Object.keys(record.controls)) if (!(key in values)) record.removeControl(key, { emitEvent: false });
      for (const [key, value] of Object.entries(values)) {
        if (record.controls[key]) record.controls[key].setValue(value, { emitEvent: false });
        else record.addControl(key, new FormControl(value, { nonNullable: true }), { emitEvent: false });
      }
    };
    sync(accounts, Object.fromEntries(this.tracked().map((a) => [a.id, prefs.accountIds === null || prefs.accountIds.includes(a.id)])));
    sync(blocks, Object.fromEntries(this.blockKeys.map((b) => [b, !prefs.hiddenBlocks.includes(b)])));
    this.curveForm.controls.total.setValue(prefs.curveTotal, { emitEvent: false });
    sync(this.curveForm.controls.accounts, Object.fromEntries(this.tracked().map((a) => [a.id, prefs.curveAccountIds.includes(a.id)])));
  }

  // Comptes tous cochés ⇒ `null` (les comptes créés plus tard s'afficheront).
  private customized(): Partial<UpdateDashboardPreferencesInput> {
    const { accounts, blocks } = this.customForm.getRawValue();
    const ids = Object.keys(accounts);
    const checked = ids.filter((id) => accounts[id]);
    return {
      accountIds: checked.length === ids.length ? null : checked,
      hiddenBlocks: this.blockKeys.filter((b) => !blocks[b]),
    };
  }

  private fail(e: unknown): void {
    this.error.set(errorMessage(e, { 409: 'Vos préférences ont été modifiées ailleurs. Rechargez pour les retrouver.' }));
    this.conflict.set(e instanceof HttpErrorResponse && e.status === 409);
  }
}
