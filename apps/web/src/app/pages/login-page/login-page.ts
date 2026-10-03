import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth-service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  errorMessage = signal<string | null>(null);
  loading = signal(false);

  loginForm = inject(FormBuilder).nonNullable.group({
    login: ['', Validators.required],
    password: ['', Validators.required],
    remember: false,
  });

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    const { login, password, remember } = this.loginForm.getRawValue();
    this.errorMessage.set(null);
    this.loading.set(true);
    this.auth.login(login, password, remember).subscribe({
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
 * - AuthService.login() : remplacer le faux Observable par http.post('/api/login', { login, password })
 *   et stocker le token reçu (localStorage si "remember", sinon sessionStorage), jamais le mot de passe.
 * - Ajouter un HttpInterceptor qui envoie le token (Authorization: Bearer ...) et redirige vers /login sur 401.
 * - Erreurs : distinguer 401 (identifiants incorrects), 0/5xx (serveur indisponible) dans le error() du subscribe,
 *   au lieu d'afficher err.message tel quel.
 * - Route "mot de passe oublié" : créer la page + remettre le lien dans le html (et le style .forgot).
 * - Redirection après login : gérer un returnUrl (route demandée avant d'être renvoyé sur /login) au lieu de /history fixe.
 * - Si l'utilisateur est déjà connecté, rediriger /login vers /dashboard.
 * - Protection brute-force / captcha : à gérer côté API (rate limiting).
 */
