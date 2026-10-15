import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Bannière affichée après une suppression logique : « Annuler » émet `undo` (restauration côté appelant). */
@Component({
  selector: 'app-undo-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="alert undo-banner" role="status">
      <span>{{ message() }}</span>
      <button type="button" class="button button-secondary" (click)="undo.emit()">Annuler</button>
    </p>
  `,
})
export class UndoBanner {
  readonly message = input.required<string>();
  readonly undo = output<void>();
}
