import { Pipe, PipeTransform } from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { eurosToCents, formatEur } from '@budgetracker/shared';

// Le front ne manipule que des centimes ; conversion uniquement via @budgetracker/shared (money.ts).

/** Affichage : {{ 123456 | eur }} → « 1 234,56 € ». */
@Pipe({ name: 'eur' })
export class EurPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    return cents == null ? '' : formatEur(cents);
  }
}

/** Champ de saisie d'un montant (> 0, ex. « 12,34 ») ; envoyer eurosToCents(control.value) à l'API. */
export function amountValidator(control: AbstractControl<string | null>): ValidationErrors | null {
  if (!control.value) return null; // laissé à Validators.required
  const cents = eurosToCents(control.value);
  return cents !== null && cents > 0 ? null : { amount: true };
}
