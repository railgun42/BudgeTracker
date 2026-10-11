import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { emailValidators, errorMessage, passwordValidators } from './auth-form';

@Component({
  selector: 'app-signup-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Créer un compte</h1>

    @if (sent()) {
      <!-- L'API répond pareil que l'adresse soit libre ou non (pas d'énumération de comptes). -->
      <p class="alert" role="status">
        Vérifiez votre boîte de réception : un lien de confirmation vous a été envoyé. Il expire dans 24 h.
      </p>
      <p><a routerLink="/login">Aller à la connexion</a></p>
    } @else {
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }

      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="signup-email">Adresse e-mail</label>
          <input
            id="signup-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            [attr.aria-invalid]="invalid('email')"
            aria-describedby="signup-email-error"
          />
          @if (invalid('email')) {
            <p id="signup-email-error" class="field-error">Saisissez une adresse e-mail valide.</p>
          }
        </div>

        <div class="field">
          <label for="signup-name">Nom</label>
          <input
            id="signup-name"
            type="text"
            formControlName="name"
            autocomplete="name"
            [attr.aria-invalid]="invalid('name')"
            aria-describedby="signup-name-error"
          />
          @if (invalid('name')) {
            <p id="signup-name-error" class="field-error">Saisissez votre nom (100 caractères max.).</p>
          }
        </div>

        <div class="field">
          <label for="signup-password">Mot de passe</label>
          <input
            id="signup-password"
            type="password"
            formControlName="password"
            autocomplete="new-password"
            [attr.aria-invalid]="invalid('password')"
            aria-describedby="signup-password-hint"
          />
          <p id="signup-password-hint" [class]="invalid('password') ? 'field-error' : 'field-hint'">
            10 caractères minimum.
          </p>
        </div>

        <button class="button" type="submit" [disabled]="pending()">Créer mon compte</button>
      </form>

      <p class="separator">ou</p>
      <a class="button button-secondary" href="/api/v1/auth/google">S'inscrire avec Google</a>

      <p>Déjà un compte ? <a routerLink="/login">Se connecter</a></p>
    }
  `,
})
export class SignupPage {
  private readonly api = inject(ApiClient);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
    name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
    password: ['', passwordValidators],
  });
  protected readonly pending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected invalid(name: 'email' | 'name' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    this.api.post<void>('/auth/signup', this.form.getRawValue()).subscribe({
      next: () => this.sent.set(true),
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 400: 'Certaines informations sont invalides. Vérifiez le formulaire.' }));
      },
    });
  }
}
