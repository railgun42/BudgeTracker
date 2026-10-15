import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountDto, InterestRatesDto, TrackingType } from '@budgetracker/shared';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session';
import { provideApiHttp } from '../../core/http';
import { today } from '../../core/today';

const USER = { id: 'u1', email: 'alice@example.com', name: 'Alice', lastConnection: null };
const COURANT: AccountDto = { id: 'a1', name: 'Courant', trackingType: TrackingType.NORMAL, openingDate: null, version: 1 };
const WALLET: AccountDto = { id: 'a2', name: 'Portefeuille', trackingType: TrackingType.NOT_TRACKED, openingDate: null, version: 3 };
const LIVRET: AccountDto = { id: 'a3', name: 'Livret A', trackingType: TrackingType.WITH_INTEREST, openingDate: null, version: 1 };
const NO_RATE: InterestRatesDto = { rates: [], missingRate: true };
const status = (code: number) => ({ status: code, statusText: String(code) });
const balanceUrl = (id: string) => `/api/v1/accounts/${id}/balance?today=${today()}`;

let harness: RouterTestingHarness;
let http: HttpTestingController;
let el: HTMLElement;

const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

function type(id: string, value: string): void {
  const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  input.dispatchEvent(new Event('blur'));
}

const stable = () => harness.fixture.whenStable();
const dialogOf = (id: string) => el.querySelector(`#${id}`)!.closest('dialog')!;

// jsdom n'implémente pas <dialog> : ouverture/fermeture minimales (attribut open + événement close).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

/** Ouvre /accounts et répond à GET /accounts puis aux soldes des comptes suivis. */
async function open(accounts: AccountDto[], currentCents = 10000): Promise<void> {
  harness = await RouterTestingHarness.create('/accounts');
  el = harness.routeNativeElement!;
  await respond(accounts, currentCents);
}

async function respond(accounts: AccountDto[], currentCents = 10000, rates = NO_RATE): Promise<void> {
  http.expectOne('/api/v1/accounts').flush(accounts);
  for (const a of accounts.filter((a) => a.trackingType !== TrackingType.NOT_TRACKED)) {
    http.expectOne(balanceUrl(a.id)).flush({ currentCents, forecastCents: currentCents });
  }
  for (const a of accounts.filter((a) => a.trackingType === TrackingType.WITH_INTEREST)) {
    http.expectOne(`/api/v1/accounts/${a.id}/interest-rates`).flush(rates);
  }
  await stable();
}

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideApiHttp(), provideHttpClientTesting()] });
  http = TestBed.inject(HttpTestingController);
  const restored = TestBed.inject(Session).restore();
  http.expectOne('/api/v1/me').flush(USER);
  await restored;
});

afterEach(() => http.verify());

describe('Comptes : liste', () => {
  it('solde du jour pour un compte suivi, aucun solde ni requête pour un portefeuille NOT_TRACKED', async () => {
    await open([COURANT, WALLET], -1234);

    const cards = [...el.querySelectorAll('li.card')].map((li) => li.textContent!.replace(/\s+/g, ' '));
    expect(cards[0]).toContain('Courant');
    expect(cards[0]).toContain('Solde : -12,34 €');
    expect(cards[1]).toContain('Non suivi (portefeuille)');
    expect(cards[1]).not.toContain('Solde');
    // afterEach : http.verify() garantit qu'aucun solde n'a été demandé pour a2.
  });

  it('solde prévisionnel affiché seulement s’il diffère du solde actuel', async () => {
    harness = await RouterTestingHarness.create('/accounts');
    el = harness.routeNativeElement!;
    http.expectOne('/api/v1/accounts').flush([COURANT]);
    http.expectOne(balanceUrl('a1')).flush({ currentCents: 5000, forecastCents: 2000 });
    await stable();
    expect(text('li.card')).toContain('Prévisionnel : 20,00 €');
  });
});

describe('Comptes : création', () => {
  it('solde de départ « -12,34 » ⇒ openingBalance de -1234 centimes à la date du jour', async () => {
    await open([]);
    expect(dialogOf('account-name').hasAttribute('open')).toBe(false);
    button('Nouveau compte').click();
    expect(dialogOf('account-name').hasAttribute('open')).toBe(true);
    type('account-name', 'Livret');
    type('account-type', TrackingType.WITH_INTEREST);
    type('account-opening', '-12,34');
    button('Créer le compte').click();

    const req = http.expectOne('/api/v1/accounts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Livret',
      trackingType: 'WITH_INTEREST',
      openingBalance: { amountCents: -1234, date: today() },
    });
    req.flush({ ...COURANT, name: 'Livret' });
    await respond([{ ...COURANT, name: 'Livret' }], -1234);
    expect(text('li.card')).toContain('Solde : -12,34 €');
    expect(dialogOf('account-name').hasAttribute('open')).toBe(false);
  });

  it('NOT_TRACKED : champ de solde de départ masqué, aucun openingBalance envoyé', async () => {
    await open([]);
    type('account-name', 'Poche');
    type('account-opening', '50');
    type('account-type', TrackingType.NOT_TRACKED);
    await stable();
    expect(el.querySelector('#account-opening')).toBeNull();

    button('Créer le compte').click();
    const req = http.expectOne('/api/v1/accounts');
    expect(req.request.body).toEqual({ name: 'Poche', trackingType: 'NOT_TRACKED' });
    req.flush(WALLET);
    await respond([WALLET]);
  });

  it('nom vide ou solde de départ invalide ⇒ aucune requête, erreurs reliées aux champs', async () => {
    await open([]);
    type('account-opening', '0');
    button('Créer le compte').click();
    await stable();

    http.expectNone('/api/v1/accounts');
    const name = el.querySelector('#account-name')!;
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector(`#${name.getAttribute('aria-describedby')}`)?.textContent).toContain('Saisissez un nom');
    expect(el.querySelector('#account-opening')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#account-opening-hint')!.className).toBe('field-error');
  });
});

describe('Comptes : édition', () => {
  it('Modifier : formulaire prérempli, focus sur le nom, PATCH avec la version', async () => {
    await open([COURANT]);
    button('Modifier').click();
    await stable();

    const name = el.querySelector<HTMLInputElement>('#account-name')!;
    expect(name.value).toBe('Courant');
    expect(dialogOf('account-name').hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(name);
    expect(el.querySelector('#account-opening')).toBeNull();

    type('account-name', 'Compte joint');
    button('Enregistrer').click();
    const req = http.expectOne('/api/v1/accounts/a1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ version: 1, name: 'Compte joint', trackingType: 'NORMAL' });
    req.flush({ ...COURANT, name: 'Compte joint', version: 2 });
    await respond([{ ...COURANT, name: 'Compte joint', version: 2 }]);

    expect(text('h2')).toBe('Nouveau compte');
    expect(dialogOf('account-name').hasAttribute('open')).toBe(false);
    expect(text('li.card')).toContain('Compte joint');
  });

  it('fermer la modale (Échap ou Annuler) abandonne la modification', async () => {
    await open([COURANT]);
    button('Modifier').click();
    await stable();
    dialogOf('account-name').close(); // Échap déclenche le même événement close
    await stable();
    expect(text('h2')).toBe('Nouveau compte');
    expect(el.querySelector<HTMLInputElement>('#account-name')!.value).toBe('');
  });

  it('409 ⇒ message clair et bouton « Recharger » qui relit les comptes', async () => {
    await open([COURANT]);
    button('Modifier').click();
    await stable();
    button('Enregistrer').click();
    http.expectOne('/api/v1/accounts/a1').flush(null, status(409));
    await stable();

    expect(text('[role="alert"]')).toContain('modifié depuis un autre écran');
    button('Recharger').click();
    await respond([{ ...COURANT, version: 2 }]);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Comptes : suppression et annulation', () => {
  it('Supprimer ⇒ DELETE, bannière « Annuler » ⇒ POST restore puis le compte revient', async () => {
    await open([COURANT]);
    button('Supprimer').click();
    const del = http.expectOne('/api/v1/accounts/a1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null, status(204));
    await respond([]);

    expect(text('[role="status"]')).toContain('Compte « Courant » supprimé');
    button('Annuler').click();
    const restore = http.expectOne('/api/v1/accounts/a1/restore');
    expect(restore.request.method).toBe('POST');
    restore.flush(COURANT);
    await respond([COURANT]);

    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(text('li.card')).toContain('Courant');
  });
});

describe('Comptes : taux d’intérêt', () => {
  it('aucun compte à intérêts ⇒ ni requête de taux ni formulaire de taux', async () => {
    await open([COURANT]);
    expect(el.querySelector('#rate-value')).toBeNull();
  });

  it('compte WITH_INTEREST sans taux ⇒ « taux manquant » signalé', async () => {
    await open([LIVRET]);
    expect(text('li.card')).toContain("Taux d'intérêt manquant : aucun intérêt ne sera crédité au 31/12.");
    expect(text('li.card')).not.toContain('Taux :');
  });

  it('taux renseigné ⇒ dernier taux affiché, pas d’alerte', async () => {
    harness = await RouterTestingHarness.create('/accounts');
    el = harness.routeNativeElement!;
    const rates: InterestRatesDto = {
      missingRate: false,
      rates: [
        { id: 'r1', accountId: 'a3', rateBp: 300, effectiveDate: '2025-01-01' },
        { id: 'r2', accountId: 'a3', rateBp: 325, effectiveDate: '2026-02-01' },
      ],
    };
    await respond([LIVRET], 10000, rates);
    expect(text('li.card')).toContain('Taux : 3,25 % à partir du 2026-02-01');
    expect(text('li.card')).not.toContain('manquant');
  });

  it('« Définir le taux » sur la carte ⇒ modale avec le compte présélectionné', async () => {
    const LIVRET_2: AccountDto = { ...LIVRET, id: 'a4', name: 'LDDS' };
    await open([LIVRET, LIVRET_2]);
    expect(el.querySelector<HTMLSelectElement>('#rate-account')!.value).toBe('a3');
    button('Définir le taux de LDDS').click();
    await stable();
    expect(dialogOf('rate-value').hasAttribute('open')).toBe(true);
    expect(el.querySelector<HTMLSelectElement>('#rate-account')!.value).toBe('a4');
  });

  it('saisie « 2,5 » ⇒ POST rateBp 250 à la date du jour sur le compte choisi, puis rechargement', async () => {
    await open([COURANT, LIVRET]);
    expect(text('li.card:first-child')).not.toContain('Définir le taux'); // compte NORMAL
    button('Définir le taux').click();
    await stable();
    expect(el.querySelector<HTMLSelectElement>('#rate-account')!.value).toBe('a3');
    type('rate-value', '2,5');
    button('Enregistrer le taux').click();

    const req = http.expectOne('/api/v1/accounts/a3/interest-rates');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ rateBp: 250, effectiveDate: today() });
    req.flush({ id: 'r1', accountId: 'a3', rateBp: 250, effectiveDate: today() });
    await respond([COURANT, LIVRET], 10000, { missingRate: false, rates: [{ id: 'r1', accountId: 'a3', rateBp: 250, effectiveDate: today() }] });
    expect(text('li.card:nth-child(2)')).toContain('Taux : 2,50 %');
    expect(el.querySelector<HTMLInputElement>('#rate-value')!.value).toBe('');
    expect(dialogOf('rate-value').hasAttribute('open')).toBe(false);
  });

  it('taux invalide (vide, > 100, 3 décimales) ⇒ aucune requête, erreur reliée au champ', async () => {
    await open([LIVRET]);
    for (const value of ['', '101', '2,555', 'abc']) {
      type('rate-value', value);
      button('Enregistrer le taux').click();
      await stable();
      http.expectNone('/api/v1/accounts/a3/interest-rates');
      expect(el.querySelector('#rate-value')!.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector('#rate-value-hint')!.className).toBe('field-error');
    }
  });
});

describe('Comptes : accessibilité', () => {
  it('chaque champ a un libellé, boutons explicites, aucun tabindex positif', async () => {
    await open([COURANT, LIVRET]);
    for (const control of el.querySelectorAll('input, select')) {
      expect(el.querySelector(`label[for="${control.id}"]`), control.id).not.toBeNull();
    }
    expect(button('Supprimer').textContent).toContain('Supprimer Courant');
    expect([...el.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0)).toEqual([]);
  });
});
