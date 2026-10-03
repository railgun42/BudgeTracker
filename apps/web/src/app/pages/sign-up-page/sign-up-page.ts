import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth-service';

const passwordsMatch = (g: AbstractControl): ValidationErrors | null =>
  g.get('password')?.value === g.get('confirmPassword')?.value ? null : { mismatch: true };

@Component({
  selector: 'app-sign-up-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './sign-up-page.html',
  styleUrl: './sign-up-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignUpPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  errorMessage = signal<string | null>(null);
  loading = signal(false);

  signUpForm = inject(FormBuilder).nonNullable.group(
    {
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
      terms: [false, Validators.requiredTrue],
    },
    { validators: passwordsMatch }
  );

  onSubmit(): void {
    if (this.signUpForm.invalid) {
      this.signUpForm.markAllAsTouched();
      return;
    }
    const { username, email, password } = this.signUpForm.getRawValue();
    this.errorMessage.set(null);
    this.loading.set(true);
    this.auth.signup(username, email, password).subscribe({
      next: () => this.router.navigate(['/history']),
      error: (err: Error) => {
        this.errorMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }
}

/*
 * TODO quand l'API sera branchée :
 * - AuthService.signup() : remplacer le faux Observable par http.post('/api/signup', { username, email, password })
 *   et stocker le token reçu, jamais le mot de passe (la validation "confirmPassword" reste uniquement côté client).
 * - Erreurs : gérer 409 (nom d'utilisateur ou email déjà pris, idéalement affiché sous le champ concerné),
 *   400 (erreurs de validation renvoyées par le serveur), 0/5xx (serveur indisponible).
 * - Vérification du nom d'utilisateur/email en direct : validateur asynchrone (GET /api/users/exists?...) avec debounce.
 * - Les règles du mot de passe (longueur, complexité) doivent être alignées avec celles du serveur.
 * - Confirmation d'email : si l'API l'exige, rediriger vers une page "vérifie ta boîte mail" au lieu de /history.
 * - Page "conditions générales d'utilisation" : créer la route et mettre le lien dans le html.
 * - Redirection : si déjà connecté, renvoyer /signup vers /history.
 * - Protection anti-bot (captcha / rate limiting) : côté API.
 */
