import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { emailValidators, errorMessage } from './auth-form';

@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mot de passe oublié</h1>

    @if (sent()) {
      <!-- Même message que le compte existe ou non. -->
      <p class="alert" role="status">
        Si un compte correspond à cette adresse, un lien de réinitialisation vient d'être envoyé. Il expire dans
        30 minutes.
      </p>
    } @else {
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="forgot-email">Adresse e-mail</label>
          <input
            id="forgot-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            [attr.aria-invalid]="invalid()"
            aria-describedby="forgot-email-error"
          />
          @if (invalid()) {
            <p id="forgot-email-error" class="field-error">Saisissez une adresse e-mail valide.</p>
          }
        </div>
        <button class="button" type="submit" [disabled]="pending()">Envoyer le lien</button>
      </form>
    }

    <p><a routerLink="/login">Retour à la connexion</a></p>
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiClient);

  protected readonly form = inject(NonNullableFormBuilder).group({ email: ['', emailValidators] });
  protected readonly pending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected invalid(): boolean {
    const c = this.form.controls.email;
    return c.invalid && c.touched;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    this.api.post<void>('/auth/forgot', this.form.getRawValue()).subscribe({
      next: () => this.sent.set(true),
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
