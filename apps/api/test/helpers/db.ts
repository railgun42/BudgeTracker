import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { PrismaService } from '../../src/prisma/prisma.service';

// Tests d'intégration contre la vraie base (Docker en dev, service Postgres en CI),
// migrée au préalable (`prisma migrate deploy`). Pas de TRUNCATE : les fichiers Jest
// tournent en parallèle, chaque test crée ses propres données (e-mails uniques).
// Pas process.loadEnvFile : il écrit dans le process.env réel, pas dans la copie isolée de Jest.
const envFile = join(__dirname, '../../../../.env');
if (existsSync(envFile)) Object.assign(process.env, { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env });

export const testPrisma = () => new PrismaService();

export const uniqueEmail = () => `test-${randomUUID()}@example.test`;
