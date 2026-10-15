import { JobRunDto } from '@budgetracker/shared';

// Dernière exécution de chaque tâche planifiée depuis le démarrage, pour GET /admin/stats (en mémoire, SPEC §13.2).
export const jobRuns: Record<'recurrences' | 'interest' | 'purge', JobRunDto | null> = { recurrences: null, interest: null, purge: null };

export async function trackJob<T>(name: keyof typeof jobRuns, run: () => Promise<T>): Promise<T> {
  let ok = false;
  try {
    const result = await run();
    ok = true;
    return result;
  } finally {
    jobRuns[name] = { at: new Date().toISOString(), ok };
  }
}
