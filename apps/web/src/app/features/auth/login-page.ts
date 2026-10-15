import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PasswordReveal } from '../../shared-ui/password-reveal';
import { Session } from '../../core/auth/session';
import { emailValidators, errorMessage } from './auth-form';

// Codes posés par l'API sur l'échec du retour Google (apps/api/src/auth/google.controller.ts).
const GOOGLE_ERRORS: Record<string, string> = {
  google: 'La connexion avec Google a échoué. Réessayez.',
  google_link_refused:
    'Connexion Google refusée : votre adresse Google doit être vérifiée pour être liée à un compte existant.',
  google_terms:
    'Aucun compte n’est associé à cette adresse Google. Pour en créer un, passez par « Créer un compte » et acceptez les CGU.',
};

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, PasswordReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card login">
      <h1>Connexion</h1>
      <p class="muted lead">Suivez vos dépenses et vos revenus, simplement.</p>

      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }

      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="login-email">Adresse e-mail</label>
          <input
            id="login-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            [attr.aria-invalid]="invalid('email')"
            aria-describedby="login-email-error"
          />
          @if (invalid('email')) {
            <p id="login-email-error" class="field-error">Saisissez une adresse e-mail valide.</p>
          }
        </div>

        <div class="field">
          <label for="login-password">Mot de passe</label>
          <div class="password-wrap">
            <input
              #pw
              id="login-password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [attr.aria-invalid]="invalid('password')"
              aria-describedby="login-password-error"
            />
            <app-password-reveal [input]="pw" />
          </div>
          @if (invalid('password')) {
            <p id="login-password-error" class="field-error">Saisissez votre mot de passe.</p>
          }
        </div>

        <button class="button" type="submit" [disabled]="pending()">Se connecter</button>
      </form>

      <p class="forgot"><a routerLink="/forgot-password">Mot de passe oublié ?</a></p>

      <p class="separator">ou</p>
      <!-- Navigation pleine page : le flux OAuth repasse par l'API puis revient sur le front. -->
      <a class="button button-secondary" href="/api/v1/auth/google">Continuer avec Google</a>
    </div>

    <p class="signup">Pas encore de compte ? <a routerLink="/signup">Créer un compte</a></p>
  `,
  styles: `
    :host {
      max-width: calc(var(--space-6) * 10);
      margin: 0 auto;
    }

    .login {
      padding: var(--space-4) var(--space-3);
    }

    h1 {
      margin-bottom: var(--space-1);
    }

    .lead {
      margin-bottom: var(--space-4);
    }

    .form {
      max-width: none;
      margin-bottom: var(--space-3);
    }

    .button {
      width: 100%;
    }

    .forgot {
      font-size: var(--text-sm);
      text-align: center;
    }

    /* « ou » encadré de deux filets */
    .separator {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-size: var(--text-sm);

      &::before,
      &::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--color-border);
      }
    }

    .signup {
      margin: var(--space-4) 0 0;
      text-align: center;
    }

    @media (min-width: 768px) {
      :host {
        margin-top: var(--space-4);
      }

      .login {
        padding: var(--space-5);
      }
    }
  `,
})
export class LoginPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(GOOGLE_ERRORS[this.query.get('error') ?? ''] ?? null);

  protected invalid(name: 'email' | 'password'): boolean {
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
    this.session.login(this.form.getRawValue()).subscribe({
      // navigateByUrl reste dans l'application : pas de redirection ouverte via returnUrl.
      next: () => this.router.navigateByUrl(this.query.get('returnUrl') ?? '/'),
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            401: 'Adresse e-mail ou mot de passe incorrect.',
            403: 'Adresse e-mail non vérifiée : ouvrez le lien reçu par e-mail.',
          }),
        );
      },
    });
  }
}
