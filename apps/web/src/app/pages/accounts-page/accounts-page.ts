import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountsServices } from '../../services/accounts-services';
import { Account } from '../../models/account';
import { TrackingType } from '../../enums/trackingType';

@Component({
  selector: 'app-accounts-page',
  imports: [RouterLink],
  templateUrl: './accounts-page.html',
  styleUrl: './accounts-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountsPage {
  private accountsService = inject(AccountsServices);

  protected readonly TrackingType = TrackingType;
  protected accounts = signal(this.accountsService.getAccounts());

  private refresh(): void {
    this.accounts.set([...this.accountsService.getAccounts()]);
  }

  // ponytail: window.prompt/confirm en attendant une vraie modale / un formulaire de compte
  add(): void {
    const name = prompt('Nom du nouveau compte :')?.trim();
    if (!name) return;
    this.accountsService.addAccount(name);
    this.refresh();
  }

  rename(account: Account): void {
    const name = prompt('Nouveau nom du compte :', account.getName())?.trim();
    if (!name) return;
    this.accountsService.renameAccount(account, name);
    this.refresh();
  }

  delete(account: Account): void {
    if (!confirm(`Supprimer le compte « ${account.getName()} » et toutes ses transactions ?`)) return;
    this.accountsService.removeAccount(account);
    this.refresh();
  }
}

/*
 * TODO quand l'API sera branchée :
 * - Charger / créer / modifier / supprimer les comptes via AccountsServices (GET/POST/PUT/DELETE /api/accounts).
 * - Formulaire dédié (nom, type de suivi, taux d'intérêt...) pour "Ajouter un compte" et "Modifier" au lieu de prompt().
 * - Modale de confirmation pour la suppression ; gérer l'erreur réseau.
 * - Solde : calculé par le serveur (une page de comptes avec beaucoup de transactions ne doit pas tout sommer côté client).
 * - Pagination / "charger plus" (les ".........." de la maquette) si beaucoup de comptes.
 * - Page "Transactions récurrentes" : ajouter l'entrée du menu du portefeuille quand elle existera
 *   (même principe que les deux autres : /recurrences?account=<id>).
 */
