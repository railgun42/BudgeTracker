import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ScenarioComparisonDto } from '@budgetracker/shared';
import { EurPipe } from '../../core/money';

// Palette catégorielle validée (dataviz, validate_palette.js, mode clair) : emplacements 1 à 5 dans cet ordre fixe,
// un par scénario selon sa position dans la comparaison. La base est une ligne grise neutre de référence.
// Trois teintes sont sous 3:1 sur le fond : la légende et le tableau de la page portent l'identité et les valeurs.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const BASELINE_COLOR = '#57606a';

const W = 640;
const H = 240;
const PAD = { top: 20, right: 8, bottom: 24, left: 8 };

/** Pas « rond » (1, 2 ou 5 × 10ⁿ centimes) pour environ 4 graduations. */
function niceStep(range: number): number {
  const raw = Math.max(range, 100) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
}

// Courbes du solde projeté, une par série ; survol ou flèches du clavier ⇒ valeurs du mois dans une infobulle.
@Component({
  selector: 'app-projection-chart',
  imports: [EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="legend" aria-label="Légende">
      @for (s of series(); track s.id) {
        <li><span class="key" [style.background]="s.color"></span>{{ s.name }}</li>
      }
    </ul>
    <div class="plot">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        role="img"
        aria-label="Courbes du solde projeté ; valeurs détaillées dans le tableau ci-dessous"
        tabindex="0"
        (pointermove)="hover($event)"
        (pointerleave)="active.set(null)"
        (blur)="active.set(null)"
        (keydown)="key($event)"
      >
        @for (t of chart().ticks; track t.value) {
          <line class="grid" [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="t.y" [attr.y2]="t.y" />
        }
        @if (chart().zeroY !== null) {
          <line class="zero" [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="chart().zeroY" [attr.y2]="chart().zeroY" />
        }
        <text class="tick" [attr.x]="PAD.left" [attr.y]="H - 6">{{ chart().first }}</text>
        <text class="tick" text-anchor="end" [attr.x]="W - PAD.right" [attr.y]="H - 6">{{ chart().last }}</text>
        @if (active() !== null) {
          <line class="cursor" [attr.x1]="chart().x(active()!)" [attr.x2]="chart().x(active()!)" [attr.y1]="PAD.top" [attr.y2]="H - PAD.bottom" />
        }
        @for (s of chart().lines; track s.id) {
          <polyline class="line" [attr.points]="s.points" [attr.stroke]="s.color" />
          @if (active() !== null) {
            <circle class="dot" r="4" [attr.cx]="chart().x(active()!)" [attr.cy]="s.ys[active()!]" [attr.fill]="s.color" />
          }
        }
        @for (t of chart().ticks; track t.value) {
          <text class="tick" [attr.x]="PAD.left" [attr.y]="t.y - 4">{{ t.value | eur }}</text>
        }
      </svg>
      @if (active() !== null) {
        <div class="tooltip" [class.flip]="active()! > chart().n / 2" [style.left.%]="(chart().x(active()!) / W) * 100" role="status">
          <strong>{{ series()[0].points[active()!].date }}</strong>
          @for (s of series(); track s.id) {
            <span class="row"><span class="key" [style.background]="s.color"></span>{{ s.name }} : {{ s.points[active()!].balanceCents | eur }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin: var(--space-2) 0 var(--space-3);
    }
    .legend {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-2);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      font-size: 0.875rem;
    }
    .key {
      display: inline-block;
      width: 1rem;
      height: 2px;
      margin-right: var(--space-1);
      vertical-align: middle;
      border-radius: 1px;
    }
    .plot {
      position: relative;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      background: var(--color-surface);
      border-radius: var(--radius);
      touch-action: pan-y;
    }
    .grid {
      stroke: var(--color-border);
      stroke-width: 1;
    }
    .zero {
      stroke: var(--color-text-muted);
      stroke-width: 1;
    }
    .tick {
      fill: var(--color-text-muted);
      font-size: 11px;
      /* Halo du fond : lisible là où une courbe passe. */
      paint-order: stroke;
      stroke: var(--color-surface);
      stroke-width: 3px;
      stroke-linejoin: round;
    }
    .line {
      fill: none;
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .cursor {
      stroke: var(--color-text-muted);
      stroke-width: 1;
    }
    .dot {
      stroke: var(--color-surface);
      stroke-width: 2;
    }
    .tooltip {
      position: absolute;
      top: var(--space-2);
      margin-left: var(--space-2);
      display: grid;
      gap: 2px;
      padding: var(--space-2);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 0.8125rem;
      white-space: nowrap;
      pointer-events: none;
    }
    .tooltip.flip {
      transform: translateX(-100%);
      margin-left: calc(-1 * var(--space-2));
    }
  `,
})
export class ProjectionChart {
  readonly data = input.required<ScenarioComparisonDto>();
  /** Nom de la série de base (trésorerie : une seule courbe). */
  readonly baselineName = input('Sans changement');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly active = signal<number | null>(null);

  protected readonly series = computed(() => {
    const { baseline, scenarios } = this.data();
    return [
      { id: 'baseline', name: this.baselineName(), color: BASELINE_COLOR, points: baseline.points },
      ...scenarios.map((s, i) => ({ id: s.id, name: s.name, color: SERIES_COLORS[i], points: s.projection.points })),
    ];
  });

  protected readonly chart = computed(() => {
    const series = this.series();
    const n = series[0].points.length;
    const values = series.flatMap((s) => s.points.map((p) => p.balanceCents));
    const step = niceStep(Math.max(...values) - Math.min(...values));
    const lo = Math.floor(Math.min(...values) / step) * step;
    const hi = Math.max(lo + step, Math.ceil(Math.max(...values) / step) * step);
    const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, n - 1);
    const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);
    const ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push({ value: v, y: y(v) });
    return {
      n,
      x,
      ticks,
      zeroY: lo < 0 && hi > 0 ? y(0) : null,
      first: series[0].points[0].date,
      last: series[0].points[n - 1].date,
      lines: series.map((s) => {
        const ys = s.points.map((p) => y(p.balanceCents));
        return { id: s.id, color: s.color, ys, points: ys.map((v, i) => `${x(i)},${v}`).join(' ') };
      }),
    };
  });

  protected hover(e: PointerEvent): void {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (!box.width) return;
    const vx = ((e.clientX - box.left) * W) / box.width;
    const n = this.chart().n;
    const i = Math.round(((vx - PAD.left) * (n - 1)) / (W - PAD.left - PAD.right));
    this.active.set(Math.min(n - 1, Math.max(0, i)));
  }

  protected key(e: KeyboardEvent): void {
    const n = this.chart().n;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    this.active.update((i) => Math.min(n - 1, Math.max(0, (i ?? (move > 0 ? -1 : n)) + move)));
  }
}
