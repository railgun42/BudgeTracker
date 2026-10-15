import { FormControl } from '@angular/forms';
import { amountValidator, EurPipe, SignedEurPipe } from './money';

describe('EurPipe', () => {
  it('formate des centimes en euros fr-FR', () => {
    expect(new EurPipe().transform(123456).replace(/\s/g, ' ')).toBe('1 234,56 €');
    expect(new EurPipe().transform(null)).toBe('');
  });
});

describe('SignedEurPipe', () => {
  it('affiche toujours le signe : « − » (U+2212) ou « + », rien pour zéro', () => {
    const f = (c: number) => new SignedEurPipe().transform(c).replace(/\s/g, ' ');
    expect(f(-5420)).toBe('−54,20 €');
    expect(f(210000)).toBe('+2 100,00 €');
    expect(f(0)).toBe('0,00 €');
  });
});

describe('amountValidator', () => {
  const check = (v: string) => amountValidator(new FormControl(v));

  it.each(['12,34', '12.34', '0,01', '1 234,5'])('accepte « %s »', (v) => expect(check(v)).toBeNull());
  it.each(['0', '-5', '1e3', '12,345', 'abc'])('refuse « %s »', (v) => expect(check(v)).toEqual({ amount: true }));
  it('laisse le champ vide à Validators.required', () => expect(check('')).toBeNull());
});
