import { Injectable } from '@angular/core';
import { UserService } from './user-service';
import { Account } from '../models/account';
import { User } from '../models/user';
import { Transaction } from '../models/transaction';

@Injectable({
  providedIn: 'root',
})
export class AccountsServices {
  private accounts: Account[] = [];

  constructor(private us:UserService){}

  public setAccounts(user:User):void{
    this.accounts = this.us.getAccounts(user);
  }

  public addTransaction(a:Account, t:Transaction):void{
    const account = this.accounts.find((item) => item === a || item.getId() === a.getId());
    if (!account) {
      return;
    }

    if (!account.getHistory()) {
      account.setHistory([]);
    }

    account.addTransaction(t);
  }
}
