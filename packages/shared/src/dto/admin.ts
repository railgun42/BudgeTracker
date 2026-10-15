// GET /admin/stats (SPEC §13.2) : agrégats uniquement, jamais d'e-mail ni de montant d'un utilisateur.

export interface JobRunDto {
  /** Horodatage ISO 8601 UTC de la fin de la dernière exécution. */
  at: string;
  ok: boolean;
}

export interface AdminStatsDto {
  users: {
    total: number;
    verified: number;
    new7d: number;
    new30d: number;
    /** D'après lastConnection. */
    active7d: number;
    active30d: number;
  };
  /** Données actives (hors suppressions logiques) ; le stockage compte toutes les pièces encore présentes. */
  volumes: {
    accounts: number;
    transactions: number;
    recurrences: number;
    attachments: number;
    storageBytes: number;
  };
  database: { sizeBytes: number; latencyMs: number };
  /** Compteurs en mémoire, remis à zéro au redémarrage (SPEC §13.2). */
  api: {
    startedAt: string;
    uptimeSeconds: number;
    memoryRssBytes: number;
    /** Erreurs serveur (5xx) depuis le démarrage. */
    errorsSinceStart: number;
    /** Dernière exécution de chaque tâche planifiée depuis le démarrage ; null si pas encore exécutée. */
    jobs: Record<'recurrences' | 'interest' | 'purge', JobRunDto | null>;
  };
}

// Catégories globales (SPEC §13.3). GET /admin/categories : toutes les globales, archivées comprises (CategoryDto,
// `hidden`/`customName` sans objet). POST /admin/categories : CreateCategoryInput (parent = racine globale non
// technique ni archivée, sinon 422 ; nom déjà pris par une sœur globale, casse ignorée ⇒ 409).
// PATCH /admin/categories/:id : renommer, recolorer, archiver (`archived: true`) ou restaurer ; technique ⇒ 422.
export interface AdminUpdateCategoryInput {
  name?: string;
  color?: string | null;
  archived?: boolean;
}
