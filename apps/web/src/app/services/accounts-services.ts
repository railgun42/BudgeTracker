import { Injectable } from '@angular/core';
import { UserService } from './user-service';
import { Account } from '../models/account';
import { User } from '../models/user';
import { Transaction } from '../models/transaction';
import { TrackingType } from '../enums/trackingType';
import { TypeTransaction } from '../enums/typeTransaction';

@Injectable({
  providedIn: 'root',
})
export class AccountsServices {
  private accounts: Account[] = [];

  constructor(private us:UserService){
    this.accounts = us.getAccounts()
  }

  public getAccounts():Account[]{
    return this.accounts = this.us.getAccounts();
  }

  // Un solde de départ non nul crée une première transaction "Solde de départ" (crédit, ou débit si négatif)
  public addAccount(name:string, tracking:TrackingType = TrackingType.NORMAL, startingBalance:number = 0):void{
    const id = Math.max(0, ...this.getAccounts().map(a => a.getId())) + 1;
    const history: Transaction[] = [];
    if (startingBalance !== 0) {
      history.push(new Transaction(
        this.nextTransactionId(),
        'Solde de départ',
        new Date(),
        Math.abs(startingBalance),
        startingBalance > 0 ? TypeTransaction.CREDIT : TypeTransaction.DEBIT,
        '',
        [],
        undefined,
        []
      ));
    }
    this.getAccounts().push(new Account(id, name, history, [], tracking));
    this.us.save();
  }

  public renameAccount(a:Account, name:string):void{
    a.setName(name);
    this.us.save();
  }

  public removeAccount(a:Account):void{
    const accounts = this.getAccounts();
    const i = accounts.indexOf(a);
    if (i >= 0) accounts.splice(i, 1);
    this.us.save();
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
    this.us.save();
  }

  // Id unique sur tous les comptes (les lignes de l'historique "Tous" sont suivies par id)
  public nextTransactionId():number{
    return Math.max(0, ...this.getAccounts().flatMap(a => a.getHistory().map(t => t.getId()))) + 1;
  }

  public removeTransaction(a:Account,t:Transaction):void{
    a.removeTransaction(t);
    this.us.save();
  }

  public getHistory(a:Account):Transaction[]{
    return a.getHistory()
  }

  //private autoUpdateTransaction()
  //applique les transcations récurrentes
}
