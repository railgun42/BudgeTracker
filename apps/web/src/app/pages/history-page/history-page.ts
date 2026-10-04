import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AccountsServices } from '../../services/accounts-services';
import { Account } from '../../models/account';
import { Transaction } from '../../models/transaction';
import { TypeTransaction } from '../../enums/typeTransaction';

type Row = { account: Account; transaction: Transaction };

@Component({
  selector: 'app-history-page',
  imports: [DatePipe],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  private accountsService = inject(AccountsServices);

  protected readonly TypeTransaction = TypeTransaction;
  protected accounts = signal(this.accountsService.getAccounts());
  // ?account=<id> (depuis la page des comptes) ; null = tous les comptes
  protected selectedAccountId = signal<number | null>(this.accountFromUrl());
  protected newestFirst = signal(true);

  protected rows = computed<Row[]>(() => {
    const id = this.selectedAccountId();
    const rows = this.accounts()
      .filter((a) => id === null || a.getId() === id)
      .flatMap((account) => account.getHistory().map((transaction) => ({ account, transaction })));
    const dir = this.newestFirst() ? -1 : 1;
    return rows.sort((a, b) => dir * (a.transaction.getDate().getTime() - b.transaction.getDate().getTime()));
  });

  private accountFromUrl(): number | null {
    const id = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('account'));
    return this.accountsService.getAccounts().some((a) => a.getId() === id) ? id : null;
  }

  onAccountChange(value: string): void {
    this.selectedAccountId.set(value === 'all' ? null : Number(value));
  }

  // Une catégorie avec parent : parent = catégorie, elle-même = sous-catégorie
  category(t: Transaction): string {
    const c = t.getCategory();
    return (c?.getParent() ?? c)?.getName() ?? 'X';
  }

  subCategory(t: Transaction): string {
    const c = t.getCategory();
    return c?.getParent() ? c.getName() : 'X';
  }

  delete(row: Row): void {
    if (!confirm(`Supprimer la transaction « ${row.transaction.getName()} » ?`)) return;
    this.accountsService.removeTransaction(row.account, row.transaction);
    this.accounts.update((a) => [...a]); // force le recalcul de rows
  }
}

/*
 * TODO quand l'API sera branchée :
 * - Charger les transactions via AccountsServices (GET /api/transactions?accountId=&sort=&page=) au lieu de tout garder en mémoire.
 * - Pagination / "charger plus" (les "........" de la maquette) : côté serveur, tri et filtres aussi.
 * - Bouton "Filtrer" : ouvrir un panneau (période, type, catégorie, montant) et envoyer les critères à l'API.
 * - Bouton "Modifier" : page ou modale d'édition (PUT /api/transactions/:id).
 * - Suppression : DELETE /api/transactions/:id, puis retirer la ligne (ou recharger) ; gérer l'erreur réseau.
 * - Remplacer confirm() par une vraie modale de confirmation.
 * - États de chargement et d'erreur de la liste.
 * - PJ : lien de téléchargement / aperçu des pièces jointes au lieu du simple compteur.
 */
