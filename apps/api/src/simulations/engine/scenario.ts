import { addMonths, SIMULATION_LIMITS, type ScenarioChange } from '@budgetracker/shared';
import { checkInt, loan } from './loan';
import type { ProjectionInput } from './projection';

const { maxMonthlyCents } = SIMULATION_LIMITS;

/** Flux signés (CREDIT +, DEBIT −) des mois 1…months. */
function flows(change: ScenarioChange, months: number, categorySpendCents: Record<string, number>): number[] {
  switch (change.kind) {
    case 'CATEGORY': {
      checkInt('Variation', change.monthlyDeltaCents, -maxMonthlyCents, maxMonthlyCents);
      // On ne peut pas économiser plus que ce qu'on dépense dans la catégorie.
      const delta = Math.max(change.monthlyDeltaCents, -(categorySpendCents[change.categoryId] ?? 0));
      return Array<number>(months).fill(-delta);
    }
    case 'SUBSCRIPTION':
      checkInt('Abonnement', change.monthlyCents, 1, maxMonthlyCents);
      return Array<number>(months).fill(-change.monthlyCents);
    case 'LOAN': {
      const { monthlyPaymentCents, lastPaymentCents } = loan(change);
      return Array.from({ length: Math.min(months, change.months) }, (_, i) => -(i === change.months - 1 ? lastPaymentCents : monthlyPaymentCents));
    }
  }
}

/**
 * Copie virtuelle (SPEC §6.2) : renvoie une nouvelle entrée de projection où chaque modification ajoute un mouvement
 * à today + k mois. L'entrée reçue n'est pas modifiée.
 * `categorySpendCents` : dépense mensuelle moyenne réelle de chaque catégorie visée sur la fenêtre (≥ 0).
 */
export function applyScenario(base: ProjectionInput, changes: ScenarioChange[], categorySpendCents: Record<string, number>): ProjectionInput {
  const events = changes.flatMap((change) =>
    flows(change, base.months, categorySpendCents).map((amountCents, i) => ({ date: addMonths(base.today, i + 1), amountCents })),
  );
  return { ...base, planned: [...base.planned, ...events] };
}
