import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PasswordReveal } from '../../shared-ui/password-reveal';
import { ApiClient } from '../../core/api-client';
import { emailValidators, errorMessage, passwordValidators } from './auth-form';

@Component({
  selector: 'app-signup-page',
  imports: [ReactiveFormsModule, RouterLink, PasswordReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card auth">
      <h1>Créer un compte</h1>

      @if (sent()) {
        <!-- L'API répond pareil que l'adresse soit libre ou non (pas d'énumération de comptes). -->
        <p class="alert" role="status">
          Vérifiez votre boîte de réception : un lien de confirmation vous a été envoyé. Il expire dans 24 h.
        </p>
        <p class="to-login"><a routerLink="/login">Aller à la connexion</a></p>
      } @else {
        <p class="muted lead">Quelques secondes suffisent pour commencer.</p>

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

          <div class="field half">
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

          <div class="field half">
            <label for="signup-password">Mot de passe</label>
            <div class="password-wrap">
              <input
                #pw
                id="signup-password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                [attr.aria-invalid]="invalid('password')"
                aria-describedby="signup-password-hint"
              />
              <app-password-reveal [input]="pw" />
            </div>
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
        <!-- Même consentement exigé pour l'inscription Google : l'API le mémorise en cookie httpOnly jusqu'au retour de Google. -->
        <a class="button button-secondary" href="/api/v1/auth/google?terms=accepted" (click)="checkTerms($event)">S'inscrire avec Google</a>
      }
    </div>

    @if (!sent()) {
      <p class="switch">Déjà un compte ? <a routerLink="/login">Se connecter</a></p>
    }
  `,
  styles: `
    :host {
      max-width: calc(var(--space-6) * 10);
      margin: 0 auto;
    }

    .auth {
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

    .to-login {
      margin: 0;
      text-align: center;
    }

    .switch {
      margin: var(--space-4) 0 0;
      text-align: center;
    }

    /* Bureau : nom et mot de passe côte à côte pour tenir sans défilement. */
    @media (min-width: 768px) {
      .auth {
        padding: var(--space-4) var(--space-5);
      }

      .lead,
      .separator {
        margin-bottom: var(--space-3);
      }

      .switch {
        margin-top: var(--space-3);
      }

      .form {
        margin-bottom: var(--space-2);
        grid-template-columns: 1fr 1fr;
        align-items: start;

        > * {
          grid-column: 1 / -1;
        }

        > .half {
          grid-column: auto;
        }
      }
    }
  `,
})
export class SignupPage {
  private readonly api = inject(ApiClient);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
    name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
    password: ['', passwordValidators],
    // Consentement CGU : exigé ici et revérifié par l'API (preuve horodatée côté serveur).
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
    this.api.post<void>('/auth/signup', this.form.getRawValue()).subscribe({
      next: () => this.sent.set(true),
      error: (e) => {
        this.pending.set(false);
        this.error.set(errorMessage(e, { 400: 'Certaines informations sont invalides. Vérifiez le formulaire.' }));
      },
    });
  }
}
