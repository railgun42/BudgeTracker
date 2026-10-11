import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Page introuvable</h1>
    <p>Cette page n'existe pas ou a été déplacée.</p>
    <a routerLink="/">Retour au tableau de bord</a>
  `,
})
export class NotFoundPage {}
