import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Session } from '../core/auth/session';

// Sans session, « / » redirige vers la connexion : le lien annonce donc la page réellement atteinte.
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Page introuvable</h1>
    <p>Cette page n'existe pas ou a été déplacée.</p>
    @if (session.user()) {
      <a routerLink="/">Retour au tableau de bord</a>
    } @else {
      <a routerLink="/login">Se connecter</a>
    }
  `,
})
export class NotFoundPage {
  protected readonly session = inject(Session);
}
