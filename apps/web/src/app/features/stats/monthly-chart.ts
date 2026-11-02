import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatEur, MonthlyStatDto } from '@budgetracker/shared';
import { SignedEurPipe } from '../../core/money';
import { niceStep } from '../simulations/projection-chart';
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** 'YYYY-MM' → « janvier 2026 ». */
export const monthLabel = (month: string): string => MONTH.format(new Date(`${month}-01`));

const SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
/** Largeur d'un mois dans le repère du SVG (étiré à la largeur disponible). */
const SLOT = 10;

// Histogramme revenus / dépenses par mois ; survol ou flèches du clavier ⇒ valeurs du mois dans une infobulle.
// Le SVG est étiré (preserveAspectRatio="none") ; graduations et mois sont en HTML pour garder la taille du texte.
@Component({
  selector: 'app-monthly-chart',
  imports: [SignedEurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="legend" aria-label="Légende">
      <li><span class="key credit"></span>Revenus</li>
      <li><span class="key debit"></span>Dépenses</li>
    </ul>
    <div class="plot">
      <div class="y" aria-hidden="true">
        @for (t of chart().ticks; track t.value) {
          <span [style.bottom.%]="t.pct">{{ t.label }}</span>
        }
      </div>
      <svg
        [attr.viewBox]="'0 0 ' + chart().w + ' 100'"
        preserveAspectRatio="none"
        role="img"
        aria-label="Histogramme des revenus et dépenses par mois ; valeurs détaillées dans le tableau ci-dessous"
        tabindex="0"
        (pointermove)="hover($event)"
        (pointerleave)="active.set(null)"
        (blur)="active.set(null)"
        (keydown)="key($event)"
      >
        @for (t of chart().ticks; track t.value) {
          <line class="grid" x1="0" [attr.x2]="chart().w" [attr.y1]="100 - t.pct" [attr.y2]="100 - t.pct" />
        }
        @if (active() !== null) {
          <rect class="hover" [attr.x]="active()! * SLOT" y="0" [attr.width]="SLOT" height="100" />
        }
        @for (m of chart().bars; track m.month; let i = $index) {
          <rect class="col credit" [attr.x]="i * SLOT + 1.25" [attr.y]="100 - m.income" width="3.5" [attr.height]="m.income" />
          <rect class="col debit" [attr.x]="i * SLOT + 5.25" [attr.y]="100 - m.expense" width="3.5" [attr.height]="m.expense" />
        }
      </svg>
      <div class="x" aria-hidden="true" [style.grid-template-columns]="'repeat(' + rows().length + ', 1fr)'">
        @for (m of chart().bars; track m.month) {
          <span>{{ m.short }}</span>
        }
      </div>
      @if (active() !== null) {
        @let m = rows()[active()!];
        <div class="tooltip" [class.flip]="active()! >= rows().length / 2" [style.left.%]="((active()! + 0.5) / rows().length) * 100" role="status">
          <strong>{{ label(m.month) }}</strong>
          <span>Revenus : {{ m.incomeCents | signedEur }}</span>
          <span>Dépenses : {{ -m.expenseCents | signedEur }}</span>
          <span>Solde : {{ m.incomeCents - m.expenseCents | signedEur }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--space-3);
    }
    .legend {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-2);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      font-size: var(--text-sm);
    }
    .key {
      display: inline-block;
      width: var(--space-3);
      height: var(--space-2);
      margin-right: var(--space-1);
      border-radius: var(--radius-sm);
      &.credit {
        background: var(--color-credit);
      }
      &.debit {
        background: var(--color-debit);
      }
    }
    .plot {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: var(--space-2);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
    .y {
      position: relative;
      min-width: 4ch;
      span {
        position: absolute;
        right: 0;
        transform: translateY(50%);
        white-space: nowrap;
      }
    }
    svg {
      display: block;
      width: 100%;
      height: 12rem;
      overflow: visible;
      touch-action: pan-y;
    }
    .grid {
      stroke: var(--color-border);
      vector-effect: non-scaling-stroke;
    }
    .hover {
      fill: var(--color-surface-2);
    }
    .col {
      transform-box: fill-box;
      transform-origin: bottom;
      animation: grow-y var(--duration-slow) var(--ease-out);
      &.credit {
        fill: var(--color-credit);
      }
      &.debit {
        fill: var(--color-debit);
      }
    }
    .x {
      grid-column: 2;
      display: grid;
      padding-top: var(--space-1);
      text-align: center;
    }
    .tooltip {
      position: absolute;
      top: 0;
      margin-left: var(--space-2);
      display: grid;
      gap: 2px;
      padding: var(--space-2);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-2);
      color: var(--color-text);
      font-size: var(--text-sm);
      white-space: nowrap;
      pointer-events: none;
    }
    .tooltip.flip {
      transform: translateX(-100%);
      margin-left: calc(-1 * var(--space-2));
    }
  `,
})
export class MonthlyChart {
  /** Mois consécutifs (trous comblés par la page), ordre chronologique. */
  readonly rows = input.required<MonthlyStatDto[]>();

  protected readonly SLOT = SLOT;
  protected readonly label = monthLabel;
  protected readonly active = signal<number | null>(null);

  protected readonly chart = computed(() => {
    const rows = this.rows();
    const step = niceStep(Math.max(...rows.flatMap((r) => [r.incomeCents, r.expenseCents])));
    const top = step * 4;
    const pct = (v: number) => (v * 100) / top;
    // Au plus 6 mois nommés sous l'axe ; les autres restent dans l'infobulle et le tableau.
    const every = Math.ceil(rows.length / 6);
    // Graduations rondes ⇒ centimes nuls : « 1 000 € » plutôt que « 1 000,00 € ».
    const ticks = [0, 1, 2, 3, 4].map((k) => ({ value: k * step, pct: k * 25, label: formatEur(k * step).replace(',00', '') }));
    return {
      w: rows.length * SLOT,
      ticks,
      bars: rows.map((r, i) => ({
        month: r.month,
        short: i % every ? '' : SHORT.format(new Date(`${r.month}-01T00:00:00Z`)),
        income: pct(r.incomeCents),
        expense: pct(r.expenseCents),
      })),
    };
  });

  protected hover(e: PointerEvent): void {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (!box.width) return;
    const n = this.rows().length;
    this.active.set(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) * n) / box.width))));
  }

  protected key(e: KeyboardEvent): void {
    const n = this.rows().length;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    this.active.update((i) => Math.min(n - 1, Math.max(0, (i ?? (move > 0 ? -1 : n)) + move)));
  }
}
