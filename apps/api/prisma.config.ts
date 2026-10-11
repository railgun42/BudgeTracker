import { defineConfig } from 'prisma/config';

// Comme `npm run start` : le .env racine s'il existe (en CI, l'environnement suffit).
try {
  process.loadEnvFile('../../.env');
} catch {
  // absent : variables déjà dans l'environnement
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // process.env et non env() : `prisma generate` doit marcher sans base.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
