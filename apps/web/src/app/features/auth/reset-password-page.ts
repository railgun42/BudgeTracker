import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { errorMessage, passwordValidators } from './auth-form';

// Cible du lien envoyé par e-mail : /reset-password?token=…
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Nouveau mot de passe</h1>

    @if (done()) {
      <p class="alert" role="status">Mot de passe modifié. Vos autres sessions ont été déconnectées.</p>
      <a class="button" routerLink="/login">Se connecter</a>
    } @else if (!token) {
      <p class="alert alert-error" role="alert">Lien incomplet. Ouvrez le lien reçu par e-mail.</p>
      <p><a routerLink="/forgot-password">Demander un nouveau lien</a></p>
    } @else {
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
        <p><a routerLink="/forgot-password">Demander un nouveau lien</a></p>
      }
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="reset-password">Nouveau mot de passe</label>
          <input
            id="reset-password"
            type="password"
            formControlName="password"
            autocomplete="new-password"
            [attr.aria-invalid]="invalid()"
            aria-describedby="reset-password-hint"
          />
          <p id="reset-password-hint" [class]="invalid() ? 'field-error' : 'field-hint'">10 caractères minimum.</p>
        </div>
        <button class="button" type="submit" [disabled]="pending()">Enregistrer</button>
      </form>
    }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(ApiClient);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');

  protected readonly form = inject(NonNullableFormBuilder).group({ password: ['', passwordValidators] });
  protected readonly pending = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  protected invalid(): boolean {
    const c = this.form.controls.password;
    return c.invalid && c.touched;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    this.api.post<void>('/auth/reset', { token: this.token, ...this.form.getRawValue() }).subscribe({
      next: () => this.done.set(true),
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 400: 'Ce lien est invalide, déjà utilisé ou expiré.' }));
      },
    });
  }
}
