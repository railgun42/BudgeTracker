import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

// Écran pas encore construit : affiche le titre de la route.
@Component({
  selector: 'app-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ title }}</h1>
    <p class="muted">Cet écran arrive bientôt.</p>
  `,
})
export class PlaceholderPage {
  protected readonly title = inject(ActivatedRoute).snapshot.title;
}
