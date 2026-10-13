import type { LocalDate } from '../local-date';
import type { ProjectionDto } from './simulation';

// Scénarios « et si » (SPEC §6.2) : modifications appliquées à une copie virtuelle de la projection d'un compte ;
// les vraies données ne sont jamais modifiées. Chaque modification produit un flux mensuel à today + k mois (k = 1…).
export type ScenarioChange =
  /** Dépenser plus (> 0) ou moins (< 0) chaque mois dans une catégorie (sous-catégories comprises).
   *  Une baisse est plafonnée à la dépense mensuelle moyenne réelle de la catégorie sur la fenêtre. */
  | { kind: 'CATEGORY'; categoryId: string; monthlyDeltaCents: number }
  /** Nouvel abonnement : dépense mensuelle fixe. */
  | { kind: 'SUBSCRIPTION'; monthlyCents: number }
  /** Achat à crédit : mensualités du calculateur de prêt (GET /simulations/loan). */
  | { kind: 'LOAN'; principalCents: number; annualRateBp: number; months: number };

export type ScenarioChangeKind = ScenarioChange['kind'];

export const SCENARIO_LIMITS = { maxNameLength: 100, maxChanges: 10, maxCompared: 5 } as const;

/** 1 à 10 modifications ; montants mensuels bornés par SIMULATION_LIMITS.maxMonthlyCents. */
export interface ScenarioParams {
  changes: ScenarioChange[];
}

export interface ScenarioDto {
  id: string;
  name: string;
  params: ScenarioParams;
  version: number;
}

// POST /scenarios. Catégorie d'un autre utilisateur ⇒ 404.
export interface CreateScenarioInput {
  name: string;
  params: ScenarioParams;
}

// PATCH /scenarios/:id. `version` périmée ⇒ 409.
export interface UpdateScenarioInput {
  version: number;
  name?: string;
  params?: ScenarioParams;
}

// GET /scenarios/compare?accountId=…&ids=id1,id2&months=12. Mêmes paramètres que la projection.
export interface CompareScenariosQuery {
  accountId: string;
  /** 1 à 5 scénarios, séparés par des virgules dans l'URL. */
  ids: string[];
  months: number;
  windowMonths?: number;
  today?: LocalDate;
}

export interface ScenarioComparisonDto {
  /** Projection sans modification. */
  baseline: ProjectionDto;
  /** Une série par scénario, dans l'ordre de `ids`. */
  scenarios: { id: string; name: string; projection: ProjectionDto }[];
}
