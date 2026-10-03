import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccountsServices } from '../../services/accounts-services';
import { Attachment } from '../../models/attachment';
import { Category } from '../../models/category';
import { Tag } from '../../models/tag';
import { Transaction } from '../../models/transaction';
import { TypeTransaction } from '../../enums/typeTransaction';

// ponytail: catégories codées en dur, à remplacer par un CategoryService (GET /api/categories)
const COLOR = '#990100';
const CATEGORIES: { category: Category; subs: Category[] }[] = [
  ['Divertissement', ['Multimédia', 'Sorties']],
  ['Sport', ['Abonnement', 'Matériel']],
  ['Courses', ['Alimentaire', 'Hygiène']],
  ['Logement', ['Loyer', 'Charges']],
].map(([name, subs], i) => {
  const category = new Category(i + 1, name as string, COLOR);
  return {
    category,
    subs: (subs as string[]).map((s, j) => new Category((i + 1) * 100 + j, s, COLOR, category)),
  };
});

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'app-new-transaction-page',
  imports: [ReactiveFormsModule],
  templateUrl: './new-transaction-page.html',
  styleUrl: './new-transaction-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewTransactionPage {
  private accountsService = inject(AccountsServices);
  private router = inject(Router);

  protected accounts = this.accountsService.getAccounts();
  protected categories = CATEGORIES.map((c) => c.category);
  protected tags = signal<string[]>([]);
  protected files = signal<File[]>([]);

  protected form = inject(FormBuilder).nonNullable.group({
    accountId: [this.accounts.at(0)?.getId() ?? 0, Validators.required],
    name: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    type: [TypeTransaction.CREDIT, Validators.required],
    date: [today(), Validators.required],
    categoryId: 0,
    subCategoryId: 0,
    details: '',
  });

  private categoryId = toSignal(this.form.controls.categoryId.valueChanges, { initialValue: 0 });
  protected subCategories = computed(
    () => CATEGORIES.find((c) => c.category.getId() === Number(this.categoryId()))?.subs ?? []
  );

  protected readonly TypeTransaction = TypeTransaction;

  onCategoryChange(): void {
    this.form.controls.subCategoryId.setValue(0);
  }

  addTag(input: HTMLInputElement): void {
    const tag = input.value.trim();
    if (tag && !this.tags().includes(tag)) this.tags.update((t) => [...t, tag]);
    input.value = '';
  }

  removeTag(tag: string): void {
    this.tags.update((t) => t.filter((x) => x !== tag));
  }

  addFiles(input: HTMLInputElement): void {
    this.files.update((f) => [...f, ...Array.from(input.files ?? [])]);
    input.value = ''; // permet de re-sélectionner le même fichier
  }

  removeFile(file: File): void {
    this.files.update((f) => f.filter((x) => x !== file));
  }

  reset(): void {
    this.form.reset();
    this.tags.set([]);
    this.files.set([]);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const account = this.accounts.find((a) => a.getId() === Number(v.accountId));
    if (!account) return;

    const all = CATEGORIES.flatMap((c) => [c.category, ...c.subs]);
    const category = all.find((c) => c.getId() === Number(v.subCategoryId || v.categoryId));

    this.accountsService.addTransaction(
      account,
      new Transaction(
        this.accountsService.nextTransactionId(),
        v.name.trim(),
        new Date(v.date),
        v.amount!,
        v.type,
        v.details.trim(),
        // ponytail: pas d'upload en local, seul le nom du fichier est gardé (url vide)
        this.files().map((f, i) => new Attachment(i + 1, f.name, f.type, '', new Date())),
        category,
        this.tags().map((t, i) => new Tag(i + 1, t))
      )
    );
    this.router.navigate(['/history']);
  }
}

/*
 * TODO quand l'API sera branchée :
 * - Envoyer la transaction via AccountsServices (POST /api/accounts/:id/transactions).
 * - Pièces jointes : upload multipart (POST /api/attachments) et stockage de l'url renvoyée ; limiter taille et types de fichiers.
 * - Catégories et sous-catégories : charger depuis l'API (CategoryService) au lieu de la liste codée en dur ; idem pour les tags existants (suggestions).
 * - Gérer l'erreur serveur (affichage d'un message) et un état de chargement sur le bouton "Valider".
 * - Si aucun compte n'existe : afficher un message / rediriger vers la création de compte.
 * - Montant : décider de la gestion des décimales / devises côté serveur.
 */
