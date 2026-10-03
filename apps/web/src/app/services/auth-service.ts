import { inject, Injectable } from '@angular/core';
import { delay, from, Observable, switchMap, throwError } from 'rxjs';
import { User } from '../models/user';
import { Account } from '../models/account';
import { UserService } from './user-service';

const SESSION_KEY = 'auth_user';
const CREDENTIALS_KEY = 'credentials';

/**
 * Connexion / inscription / session.
 * Version locale simulée : login() et signup() deviennent des http.post, la session devient un token,
 * et CREDENTIALS_KEY (hash des mots de passe) disparaît : seul le serveur connaît les mots de passe.
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userService = inject(UserService);

  constructor() {
    // Restaure la session après un rechargement de page
    const saved = this.getUser();
    if (saved && !this.userService.setCurrent(saved.username)) this.logout();
  }

  login(username: string, password: string, remember = false): Observable<void> {
    return this.hash(password).pipe(
      delay(300),
      switchMap((hash) => {
        const user = this.userService.findByUsername(username);
        if (!user || this.credentials()[user.getId()] !== hash) {
          return throwError(() => new Error('Identifiants incorrects'));
        }
        this.startSession(user.getUsername(), remember);
        return [undefined];
      })
    );
  }

  signup(username: string, email: string, password: string): Observable<void> {
    return this.hash(password).pipe(
      delay(300),
      switchMap((hash) => {
        const user = this.buildUser(username.trim(), email.trim());
        if (!this.userService.add(user)) {
          return throwError(() => new Error("Ce nom d'utilisateur est déjà pris"));
        }
        localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ ...this.credentials(), [user.getId()]: hash }));
        this.startSession(user.getUsername(), false);
        return [undefined];
      })
    );
  }

  logout(): void {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    this.userService.clearCurrent();
  }

  isAuthenticated(): boolean {
    return this.getUser() !== null;
  }

  getUser(): { username: string } | null {
    const user = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    return user ? JSON.parse(user) : null;
  }

  // "Rester connecté" : localStorage (survit à la fermeture), sinon sessionStorage
  private startSession(username: string, remember: boolean): void {
    this.logout();
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify({ username }));
    this.userService.setCurrent(username);
  }

  private credentials(): Record<number, string> {
    return JSON.parse(localStorage.getItem(CREDENTIALS_KEY) ?? '{}');
  }

  // ponytail: SHA-256 sans sel, uniquement pour ne pas stocker le mot de passe en clair en local. L'API le remplace.
  private hash(password: string): Observable<string> {
    return from(
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
        .then((buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''))
    );
  }

  // Nouvel utilisateur avec un compte vide, à remplacer par la réponse du backend
  private buildUser(username: string, mail: string): User {
    return new User(this.userService.nextId(), username, mail, '', new Date(), [
      new Account(1, 'Compte principal', [], []),
    ]);
  }
}
