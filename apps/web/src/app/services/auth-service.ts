import { inject, Injectable } from '@angular/core';
import { User } from '../models/user';
import { Account } from '../models/account';
import { UserService } from './user-service';
import { Transaction } from '../models/transaction';
import { TypeTransaction } from '../enums/typeTransaction';
import { Category } from '../models/category';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly STORAGE_KEY = 'auth_user';
  private userService = inject(UserService);

  constructor() {
    const saved = this.getUser();
    if (saved) this.userService.setUser(this.buildUser(saved.username));
  }

  login(username: string, password: string): boolean {
    if (username && password) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ username, password }));
      this.userService.setUser(this.buildUser(username));
      return true;
    }
    return false;
  }

  logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }

  getUser() {
    const user = localStorage.getItem(this.STORAGE_KEY);
    return user ? JSON.parse(user) : null;
  }

  //user + compte par défaut fabriqués en local, à remplacer par un appel backend
  private buildUser(username: string): User {
    return new User(
      1,
      username,
      '',
      '',
      new Date(),
      [
        new Account(
          1,
          'Compte principal',
          [
            new Transaction(
              1,
              'Courses',
              new Date(),
              50,
              TypeTransaction.CREDIT,
              '',
              [],
              undefined,
              []
            ),new Transaction(
              1,
              'Virement de clément',
              new Date(),
              25,
              TypeTransaction.DEBIT,
              '',
              [],
              undefined,
              []
            )
          ],
          []
        )
      ]
    );
  }
}
