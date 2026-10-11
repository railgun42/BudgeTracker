export interface Env {
  DATABASE_URL: string;
  PORT: number;
}

// Valide l'environnement au démarrage : toute erreur empêche l'API de démarrer.
export function loadEnv(env: NodeJS.ProcessEnv): Env {
  const errors: string[] = [];
  if (!env.DATABASE_URL) errors.push('DATABASE_URL manquante');
  if ((env.JWT_SECRET ?? '').length < 32) errors.push('JWT_SECRET manquante ou trop courte (32 caractères min.)');
  if (env.NODE_ENV === 'production' && !env.SMTP_URL) errors.push('SMTP_URL manquante');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT invalide');
  if (errors.length) throw new Error(`Configuration invalide : ${errors.join(', ')}`);
  return { DATABASE_URL: env.DATABASE_URL!, PORT: port };
}
