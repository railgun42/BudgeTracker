import { Injectable } from '@angular/core';
import { User } from '../models/user';
import { Account } from '../models/account';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private user?: User;

  public setUser(user: User): void {
    this.user = user;
  }

  public getAccounts():Account[]{
    return this.user?.getAccounts() ?? [];
  }
}
