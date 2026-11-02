import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { SignedEurPipe } from '../../core/money';

export interface DonutPart {
  key: string;
  label: string;
  /** Dépense en centimes (> 0). */
  cents: number;
}

const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent' });

// Donut des dépenses : 5 premières parts (ordre reçu) + « Autres » ; couleurs --chart-1…5 par rang, fixes quand on décoche.
// Survol d'une part ⇒ infobulle nom · part · montant ; la légende (cases à cocher) donne les mêmes valeurs au clavier.
// Une part décochée reste dans la légende et sort du donut ; les pourcentages sont recalculés sur les parts cochées.
@Component({
  selector: 'app-donut-chart',
  imports: [SignedEurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = donut();
    <figure class="donut">
      <div class="donut-plot" (pointerleave)="hovered.set(null)">
        <svg viewBox="0 0 42 42" role="img" [attr.aria-label]="description()">
          @for (s of d.slices; track s.key) {
            <circle
              class="slice"
              [class.dim]="hovered() && hovered()!.key !== s.key"
              cx="21"
              cy="21"
              r="15.9155"
              [style.stroke]="s.color"
              [attr.stroke-dasharray]="s.dash"
              [attr.stroke-dashoffset]="s.offset"
              (pointermove)="hover($event, s.key)"
              (pointerdown)="hover($event, s.key)"
            />
          }
        </svg>
        @if (hoveredSlice(); as h) {
          <div class="tooltip" [style.left.px]="hovered()!.x" [style.top.px]="hovered()!.y" aria-hidden="true">
            <strong>{{ h.label }}</strong>
            <span>{{ h.share }} · {{ -h.cents | signedEur }}</span>
          </div>
        }
        @if (!d.slices.length) {
          <p class="donut-empty muted">Rien de coché.</p>
        }
      </div>
      <figcaption>
        <span class="muted">{{ title() }}</span>
        <ul class="legend" [attr.aria-label]="'Légende : ' + title()">
          @for (s of d.legend; track s.key) {
            <li>
              <label [class.off]="!s.included">
                <input type="checkbox" [checked]="s.included" (change)="toggle(s.key)" />
                <span class="key" [style.background]="s.color"></span>
                <span class="legend-label">{{ s.label }}</span>
                <span class="visually-hidden">, </span>
                <span class="num">{{ s.included ? s.share : 'retirée' }}</span>
              </label>
            </li>
          }
        </ul>
        <ng-content />
      </figcaption>
    </figure>
  `,
  styles: `
    .donut {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3) var(--space-4);
      margin: 0 0 var(--space-3);
      figcaption {
        flex: 1 1 12rem;
        font-size: var(--text-sm);
      }
    }
    .donut-plot {
      position: relative;
      flex: none;
      svg {
        display: block;
        width: 9rem;
        height: 9rem;
        transform: rotate(-90deg);
      }
    }
    .slice {
      fill: none;
      stroke-width: 6;
      transition: opacity var(--duration-fast) ease;
      &.dim {
        opacity: 0.35;
      }
    }
    .donut-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      margin: 0;
      padding: var(--space-5);
      text-align: center;
      font-size: var(--text-xs);
    }
    .tooltip {
      position: absolute;
      z-index: 1;
      display: grid;
      gap: 2px;
      padding: var(--space-2);
      transform: translate(-50%, calc(-100% - var(--space-2)));
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-2);
      color: var(--color-text);
      font-size: var(--text-sm);
      white-space: nowrap;
      pointer-events: none;
      animation: pop var(--duration-fast) var(--ease-out);
    }
    .legend {
      list-style: none;
      margin: var(--space-1) 0 0;
      padding: 0;
      display: grid;
      label {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--tap);
        cursor: pointer;
      }
      input {
        width: 1.125rem;
        height: 1.125rem;
        margin: 0;
        flex: none;
        accent-color: var(--color-primary);
      }
      .off .key {
        opacity: 0.35;
      }
      .off .legend-label {
        text-decoration: line-through;
        color: var(--color-text-muted);
      }
    }
    .legend-label {
      flex: 1;
    }
    .key {
      width: var(--space-3);
      height: var(--space-3);
      flex: none;
      border-radius: var(--radius-sm);
    }
  `,
})
export class DonutChart {
  /** Parts dans l'ordre d'affichage (dépenses décroissantes), montants > 0. */
  readonly parts = input.required<DonutPart[]>();
  /** Titre visible au-dessus de la légende. */
  readonly title = input.required<string>();
  /** Nom accessible du graphique (renvoyer au tableau ou à la légende). */
  readonly description = input.required<string>();

  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  protected readonly hovered = signal<{ key: string; x: number; y: number } | null>(null);

  protected readonly donut = computed(() => {
    const rows = this.parts();
    const parts = rows.length > 5 ? [...rows.slice(0, 5), { key: '\u0000other', label: 'Autres', cents: rows.slice(5).reduce((s, r) => s + r.cents, 0) }] : rows;
    const excluded = this.excluded();
    const total = parts.reduce((s, r) => s + (excluded.has(r.key) ? 0 : r.cents), 0);
    const legend = parts.map((r, i) => ({
      ...r,
      color: i === 5 ? 'var(--chart-other)' : `var(--chart-${i + 1})`,
      included: !excluded.has(r.key),
      share: total ? PERCENT.format(r.cents / total) : '',
    }));
    const kept = legend.filter((s) => s.included);
    // Circonférence 100 ; 0,6 d'écart laisse voir la surface entre deux parts (aucun s'il n'en reste qu'une).
    const gap = kept.length > 1 ? 0.6 : 0;
    let start = 0;
    const slices = kept.map((s) => {
      const pct = (s.cents * 100) / total;
      const len = Math.max(pct - gap, 0.2);
      const slice = { ...s, dash: `${len} ${100 - len}`, offset: -start };
      start += pct;
      return slice;
    });
    return { legend, slices };
  });

  protected readonly hoveredSlice = computed(() => {
    const key = this.hovered()?.key;
    return this.donut().slices.find((s) => s.key === key);
  });

  protected toggle(key: string): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected hover(e: PointerEvent, key: string): void {
    const box = (e.currentTarget as Element).closest('.donut-plot')!.getBoundingClientRect();
    this.hovered.set({ key, x: e.clientX - box.left, y: e.clientY - box.top });
  }
}
