import { Injectable } from '@angular/core';
import { User } from '../models/user';
import { Account } from '../models/account';
import { Transaction } from '../models/transaction';

const USERS_KEY = 'users';

/**
 * Stocke les utilisateurs et l'utilisateur courant.
 * Version locale (localStorage) : à terme, les méthodes publiques deviennent des appels API
 * (GET /api/users/me, ...) et la persistance (load/save) disparaît.
 */
@Injectable({
  providedIn: 'root',
})
export class UserService {
  private users: User[] = this.load();
  private current?: User;

  public getCurrentUser(): User | undefined {
    return this.current;
  }

  public getAccounts(): Account[] {
    return this.current?.getAccounts() ?? [];
  }

  // Définit l'utilisateur courant. Renvoie false si le nom est inconnu.
  public setCurrent(username: string): boolean {
    this.current = this.findByUsername(username);
    return this.current !== undefined;
  }

  public clearCurrent(): void {
    this.current = undefined;
  }

  // Insensible à la casse et aux espaces ("Bob" et " bob " sont le même utilisateur)
  public findByUsername(username: string): User | undefined {
    const name = username.trim().toLowerCase();
    return this.users.find((u) => u.getUsername().toLowerCase() === name);
  }

  public nextId(): number {
    return Math.max(0, ...this.users.map((u) => u.getId())) + 1;
  }

  // Ajoute un nouvel utilisateur. Renvoie false si le nom est déjà pris (pas de doublon).
  public add(user: User): boolean {
    if (this.findByUsername(user.getUsername())) return false;
    this.users.push(user);
    this.save();
    return true;
  }

  // À appeler après toute modification d'un utilisateur / compte / transaction
  public save(): void {
    localStorage.setItem(USERS_KEY, JSON.stringify(this.users));
  }

  private load(): User[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.map((u) => this.revive(u)) : [];
    } catch {
      return [];
    }
  }

  // JSON.parse renvoie des objets sans méthodes ni Date : on les reconstruit
  // ponytail: Category/Tag/Attachment/Recurrence non reconstruits, à ajouter quand ils auront des méthodes
  private revive(u: User): User {
    const user = Object.assign(Object.create(User.prototype), u);
    user.accounts = user.accounts.map((a: Account) => {
      const account = Object.assign(Object.create(Account.prototype), a);
      account.history = account.history.map((t: Transaction) => {
        const tr = Object.assign(Object.create(Transaction.prototype), t);
        tr.date = new Date(tr.date);
        return tr;
      });
      return account;
    });
    user.lastConnection = new Date(user.lastConnection);
    return user;
  }
}
