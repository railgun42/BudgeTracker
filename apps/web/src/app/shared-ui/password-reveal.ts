import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Bouton « œil » : le mot de passe est visible tant que le bouton est maintenu (souris, doigt, Espace/Entrée),
 * et se recache dès qu'on relâche ou qu'on quitte le bouton.
 * Usage : `<input #pw type="password" …/> <app-password-reveal [input]="pw" />` dans un `.password-wrap`.
 */
@Component({
  selector: 'app-password-reveal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointerdown)': 'show($event)',
    '(pointerup)': 'hide()',
    '(pointerleave)': 'hide()',
    '(pointercancel)': 'hide()',
    '(focusout)': 'hide()',
    '(keydown)': 'onKey($event, true)',
    '(keyup)': 'onKey($event, false)',
    '(contextmenu)': '$event.preventDefault()',
  },
  template: `
    <button type="button" class="password-reveal" aria-label="Afficher le mot de passe (maintenir appuyé)">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      top: 0;
      right: 0;
    }

    .password-reveal {
      display: grid;
      place-items: center;
      width: var(--tap);
      height: var(--tap);
      padding: 0;
      border: 0;
      border-radius: var(--radius);
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
      touch-action: none;
      user-select: none;

      &:hover,
      &:active {
        color: var(--color-text);
      }
    }
  `,
})
export class PasswordReveal {
  readonly input = input.required<HTMLInputElement>();

  protected show(event: Event): void {
    event.preventDefault(); // garde le focus dans le champ, évite la sélection de texte
    this.input().type = 'text';
  }

  protected hide(): void {
    this.input().type = 'password';
  }

  protected onKey(event: KeyboardEvent, down: boolean): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (down) this.show(event);
    else this.hide();
  }
}
