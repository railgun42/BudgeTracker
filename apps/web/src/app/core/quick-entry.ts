import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export type QuickEntryKind = 'transaction' | 'transfer';

// Saisie rapide en modale (coquille) : ouvrable depuis toute page ; les routes /transactions/new et /transfers/new restent des pages.
@Injectable({ providedIn: 'root' })
export class QuickEntry {
  /** Formulaire affiché dans la modale de la coquille ; null = fermée. */
  readonly open = signal<QuickEntryKind | null>(null);
  /** Message de succès après un enregistrement fait en modale : la coquille ferme et l'affiche, la page courante relit ses données. */
  readonly saved = new Subject<string>();
}
