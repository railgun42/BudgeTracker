import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth-service';

@Component({
  selector: 'app-sign-up-page',
  imports: [],
  templateUrl: './sign-up-page.html',
  styleUrl: './sign-up-page.scss',
})
export class SignUpPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  signUp(username: string, password: string): void {
    if (this.auth.login(username, password)) {
      this.router.navigate(['/history']);
    }
  }
}
