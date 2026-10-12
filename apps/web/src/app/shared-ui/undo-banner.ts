import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Bannière affichée après une suppression logique : « Annuler » émet `undo` (restauration côté appelant). */
@Component({
  selector: 'app-undo-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="alert" role="status">
      {{ message() }}
      <button type="button" class="link-button" (click)="undo.emit()">Annuler</button>
    </p>
  `,
})
export class UndoBanner {
  readonly message = input.required<string>();
  readonly undo = output<void>();
}
