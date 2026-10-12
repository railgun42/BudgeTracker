import type { TrackingType } from '../enums';
import type { LocalDate } from '../local-date';

// Pas de solde : il est calculé (SPEC §3.3).
export interface AccountDto {
  id: string;
  name: string;
  trackingType: TrackingType;
  version: number;
}

// POST /accounts. Solde de départ : montant signé (≠ 0), interdit pour NOT_TRACKED ;
// crée une transaction « Solde de départ » (CREDIT si > 0, DEBIT si < 0).
export interface CreateAccountInput {
  name: string;
  trackingType: TrackingType;
  openingBalance?: { amountCents: number; date: LocalDate };
}

// PATCH /accounts/:id. `version` périmée ⇒ 409.
export interface UpdateAccountInput {
  version: number;
  name?: string;
  trackingType?: TrackingType;
}

export interface InterestRateDto {
  id: string;
  accountId: string;
  /** Taux annuel en points de base (300 = 3,00 %). */
  rateBp: number;
  effectiveDate: LocalDate;
}

// GET /accounts/:id/interest-rates : historique trié par date d'effet. `missingRate` : compte WITH_INTEREST
// sans taux en vigueur cette année ⇒ aucun intérêt ne sera crédité au 31/12 (SPEC §3.5).
export interface InterestRatesDto {
  rates: InterestRateDto[];
  missingRate: boolean;
}

// POST /accounts/:id/interest-rates : crée ou remplace le taux à cette date d'effet. Compte non WITH_INTEREST ⇒ 422.
export interface CreateInterestRateInput {
  /** Entier, 0 à 10 000 (100 %). */
  rateBp: number;
  effectiveDate: LocalDate;
}

// GET /accounts/:id/balance[?today=YYYY-MM-DD] (jour du client ; défaut : jour UTC du serveur).
// Actuel = transactions datées ≤ today ; prévisionnel = toutes. `null` pour un compte NOT_TRACKED.
export interface AccountBalanceDto {
  currentCents: number | null;
  forecastCents: number | null;
}
