import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatEur, LocalDate } from '@budgetracker/shared';
import { EurPipe } from '../../core/money';
import { niceStep } from '../simulations/projection-chart';

export interface BalanceLine {
  id: string;
  name: string;
  /** Le total est tracé plus épais que les comptes. */
  total: boolean;
  /** Un solde par jour de `dates`, en centimes. */
  cents: number[];
}

const W = 640;
const H = 220;
const PAD = { top: 18, right: 8, bottom: 24, left: 8 };
// Comptes : couleur (--chart-1…5) ET motif de trait, pour ne pas dépendre de la couleur seule ; le total est plein, épais, couleur du texte.
const DASHES = ['', '7 3', '2 3', '9 3 2 3', '1 4'];
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLabel = (d: LocalDate) => DAY.format(new Date(`${d}T00:00:00Z`));

// Évolution du solde, jour par jour : une courbe par compte choisi et le total. Survol ou flèches du clavier ⇒ valeurs du jour.
@Component({
  selector: 'app-balance-chart',
  imports: [EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="legend" aria-label="Légende">
      @for (l of lines(); track l.id) {
        <li>
          <svg viewBox="0 0 24 8" width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" [attr.stroke]="l.color" [attr.stroke-width]="l.width" [attr.stroke-dasharray]="l.dash" /></svg>
          {{ l.name }}
        </li>
      }
    </ul>
    <div class="plot">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="description()" tabindex="0" (pointermove)="hover($event)" (pointerleave)="active.set(null)" (blur)="active.set(null)" (keydown)="key($event)">
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
        @for (l of chart().lines; track l.id) {
          <polyline class="line" [attr.points]="l.points" [attr.stroke]="l.color" [attr.stroke-width]="l.width" [attr.stroke-dasharray]="l.dash" />
          <circle class="dot" r="4" [attr.cx]="chart().x(active() ?? chart().n - 1)" [attr.cy]="l.ys[active() ?? chart().n - 1]" [attr.fill]="l.color" />
        }
        @for (t of chart().ticks; track t.value) {
          <text class="tick" [attr.x]="PAD.left" [attr.y]="t.y - 4">{{ t.value | eur }}</text>
        }
      </svg>
      @if (active() !== null) {
        <div class="tooltip" [class.flip]="active()! > chart().n / 2" [style.left.%]="(chart().x(active()!) / W) * 100" role="status">
          <strong>{{ dates()[active()!] }}</strong>
          @for (l of lines(); track l.id) {
            <span>{{ l.name }} : {{ l.cents[active()!] | eur }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); padding: 0; margin: 0 0 var(--space-2); list-style: none; font-size: var(--text-sm); }
    .legend li { display: flex; align-items: center; gap: var(--space-1); }
    .plot { position: relative; }
    svg[role='img'] { display: block; width: 100%; height: auto; background: var(--color-surface); border-radius: var(--radius); touch-action: pan-y; }
    .grid { stroke: var(--color-border); }
    .zero, .cursor { stroke: var(--color-text-muted); }
    .tick { fill: var(--color-text-muted); font-size: 11px; paint-order: stroke; stroke: var(--color-surface); stroke-width: 3px; stroke-linejoin: round; }
    .line { fill: none; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .dot { stroke: var(--color-surface); stroke-width: 2; }
    .tooltip { position: absolute; top: var(--space-2); display: grid; gap: 2px; margin-left: var(--space-2); padding: var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); font-size: var(--text-sm); white-space: nowrap; pointer-events: none; }
    .tooltip.flip { transform: translateX(-100%); margin-left: calc(-1 * var(--space-2)); }
  `,
})
export class BalanceChart {
  /** Jours consécutifs 'YYYY-MM-DD', du premier au dernier. */
  readonly dates = input.required<LocalDate[]>();
  /** Au moins une courbe. */
  readonly series = input.required<BalanceLine[]>();

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly active = signal<number | null>(null);

  /** Style de chaque courbe : le total d'abord, puis les comptes dans l'ordre reçu. */
  protected readonly lines = computed(() => {
    let rank = 0;
    return this.series().map((s) => {
      if (s.total) return { ...s, color: 'var(--color-text)', width: 3.5, dash: '' };
      const i = rank++;
      return { ...s, color: `var(--chart-${(i % 5) + 1})`, width: 1.75, dash: DASHES[i % DASHES.length] };
    });
  });

  /** Alternative textuelle : début et fin de chaque courbe ; le détail jour par jour est dans l'infobulle (clavier compris). */
  protected readonly description = computed(() => {
    const dates = this.dates();
    const ends = this.lines().map((l) => `${l.name} de ${formatEur(l.cents[0])} à ${formatEur(l.cents[l.cents.length - 1])}`);
    return `Évolution du solde du ${dayLabel(dates[0])} au ${dayLabel(dates[dates.length - 1])} : ${ends.join(' ; ')}. Flèches gauche et droite pour lire les valeurs jour par jour.`;
  });

  protected readonly chart = computed(() => {
    const lines = this.lines();
    const n = this.dates().length;
    const values = lines.flatMap((l) => l.cents);
    const step = niceStep(Math.max(...values) - Math.min(...values));
    const lo = Math.floor(Math.min(...values) / step) * step;
    const hi = Math.max(lo + step, Math.ceil(Math.max(...values) / step) * step);
    const x = (i: number) => (n === 1 ? W / 2 : PAD.left + (i * (W - PAD.left - PAD.right)) / (n - 1));
    const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);
    const ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push({ value: v, y: y(v) });
    return {
      n,
      x,
      ticks,
      zeroY: lo < 0 && hi > 0 ? y(0) : null,
      first: dayLabel(this.dates()[0]),
      last: dayLabel(this.dates()[n - 1]),
      lines: lines.map((l) => {
        const ys = l.cents.map(y);
        return { ...l, ys, points: ys.map((v, i) => `${x(i)},${v}`).join(' ') };
      }),
    };
  });

  protected hover(e: PointerEvent): void {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (!box.width) return;
    const n = this.chart().n;
    const i = Math.round(((((e.clientX - box.left) * W) / box.width - PAD.left) * (n - 1)) / (W - PAD.left - PAD.right));
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
