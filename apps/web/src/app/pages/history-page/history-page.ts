import { Component } from '@angular/core';
import { AccountsServices } from '../../services/accounts-services';
import { Account } from '../../models/account';

@Component({
  selector: 'app-history-page',
  imports: [],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
})
export class HistoryPage {
  protected accounts:Account[]

  constructor(private ac:AccountsServices){
    this.accounts = ac.getAccounts()
  }
}
