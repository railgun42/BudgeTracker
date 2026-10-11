import type { TrackingType } from '../enums';
import type { LocalDate } from '../local-date';

// Pas de solde : il est calculé (SPEC §3.3).
export interface AccountDto {
  id: string;
  name: string;
  trackingType: TrackingType;
  version: number;
}

export interface InterestRateDto {
  id: string;
  accountId: string;
  /** Taux annuel en points de base (300 = 3,00 %). */
  rateBp: number;
  effectiveDate: LocalDate;
}
