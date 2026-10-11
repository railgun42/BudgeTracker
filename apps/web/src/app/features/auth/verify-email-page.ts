import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from './auth-form';

// Cible du lien envoyé par e-mail : /verify-email?token=…
@Component({
  selector: 'app-verify-email-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Vérification de l'adresse e-mail</h1>
    @switch (status()) {
      @case ('pending') {
        <p role="status">Vérification en cours…</p>
      }
      @case ('done') {
        <p class="alert" role="status">Votre adresse est confirmée. Vous pouvez vous connecter.</p>
        <a class="button" routerLink="/login">Se connecter</a>
      }
      @case ('error') {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
        <p><a routerLink="/signup">Recommencer l'inscription</a></p>
      }
    }
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');

  protected readonly status = signal<'pending' | 'done' | 'error'>('pending');
  protected readonly error = signal('');

  ngOnInit(): void {
    if (!this.token) return this.fail('Lien de vérification incomplet. Ouvrez le lien reçu par e-mail.');
    this.api.post<void>('/auth/verify-email', { token: this.token }).subscribe({
      next: () => this.status.set('done'),
      error: (e) => this.fail(errorMessage(e, { 400: 'Ce lien est invalide, déjà utilisé ou expiré.' })),
    });
  }

  private fail(message: string): void {
    this.error.set(message);
    this.status.set('error');
  }
}
