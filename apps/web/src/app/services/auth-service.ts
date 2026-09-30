import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly STORAGE_KEY = 'auth_user';

  login(username: string, password: string): boolean {
    if (username && password) {
      const user = { username, password };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
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
}