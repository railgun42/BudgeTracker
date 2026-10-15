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

/** Montant signé : {{ -5420 | signedEur }} → « −54,20 € » (U+2212), {{ 210000 | signedEur }} → « +2 100,00 € », 0 sans signe. */
@Pipe({ name: 'signedEur' })
export class SignedEurPipe implements PipeTransform {
  transform(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatEur(Math.abs(cents));
  }
}

/** Champ de saisie d'un montant (> 0, ex. « 12,34 ») ; envoyer eurosToCents(control.value) à l'API. */
export function amountValidator(control: AbstractControl<string | null>): ValidationErrors | null {
  if (!control.value) return null; // laissé à Validators.required
  const cents = eurosToCents(control.value);
  return cents !== null && cents > 0 ? null : { amount: true };
}
