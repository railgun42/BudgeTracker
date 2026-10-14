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

        <div class="field">
          <label class="checkbox">
            <input
              id="signup-terms"
              type="checkbox"
              formControlName="acceptTerms"
              [attr.aria-invalid]="invalid('acceptTerms')"
              aria-describedby="signup-terms-error"
            />
            <span>
              J'accepte les <a routerLink="/cgu" target="_blank">conditions générales d'utilisation<span class="visually-hidden"> (nouvel onglet)</span></a> et j'ai lu la
              <a routerLink="/confidentialite" target="_blank">politique de confidentialité<span class="visually-hidden"> (nouvel onglet)</span></a>.
            </span>
          </label>
          @if (invalid('acceptTerms')) {
            <p id="signup-terms-error" class="field-error">Vous devez accepter les CGU pour créer un compte.</p>
          }
        </div>

        <button class="button" type="submit" [disabled]="pending()">Créer mon compte</button>
      </form>

      <p class="separator">ou</p>
      <!-- Même consentement exigé pour l'inscription Google. -->
      <a class="button button-secondary" href="/api/v1/auth/google" (click)="checkTerms($event)">S'inscrire avec Google</a>

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
    // Consentement CGU : exigé ici, non transmis (l'API refuse les champs inconnus).
    acceptTerms: [false, Validators.requiredTrue],
  });
  protected readonly pending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected invalid(name: 'email' | 'name' | 'password' | 'acceptTerms'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected checkTerms(event: Event): void {
    const terms = this.form.controls.acceptTerms;
    if (terms.value) return;
    event.preventDefault();
    terms.markAsTouched();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    const { email, name, password } = this.form.getRawValue();
    this.api.post<void>('/auth/signup', { email, name, password }).subscribe({
      next: () => this.sent.set(true),
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 400: 'Certaines informations sont invalides. Vérifiez le formulaire.' }));
      },
    });
  }
}
