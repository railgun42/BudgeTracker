import { Component } from '@angular/core';
import { AccountsServices } from '../../services/accounts-services';
import { Account } from '../../models/account';
import { Transaction } from '../../models/transaction';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-history-page',
  imports: [FormsModule,DatePipe],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
})
export class HistoryPage {
  protected accounts:Account[];
  protected selectedAccount:Account;
  protected transactions:Transaction[];

  constructor(private ac:AccountsServices){
    this.accounts = ac.getAccounts()
    this.selectedAccount = this.accounts.at(0)!;
    this.transactions = this.selectedAccount.getHistory();
  }

  onAccountChange() {
    this.transactions = this.selectedAccount.getHistory();
  }
}
