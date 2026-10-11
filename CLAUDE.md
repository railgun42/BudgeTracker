# BudgeTracker

Sources de vérité : SPEC.md (le quoi), PLAN.md (l'ordre). Une étape à la fois ;
ne pas passer à la suivante tant que sa « Vérif » n'est pas verte.

## Règles du domaine (pièges)
- Montants : entiers en centimes, jamais de float. Conversion € ⇄ centimes
  uniquement dans packages/shared/src/money.ts.
- Dates de transaction : chaîne 'YYYY-MM-DD' (jour, sans fuseau). Jamais de `Date` dans les DTO.
- Chaque requête sur une table métier filtre `userId` ET `deletedAt IS NULL`.
  Tout nouvel endpoint s'ajoute au registre d'isolation (apps/api/test/helpers/isolation-registry.ts).
- Les dossiers `**/engine/` sont purs : aucun import Nest/Prisma (le lint l'impose).
- Un virement = 2 transactions liées par transferId, un seul verrou de version.
- Migrations Prisma versionnées uniquement, jamais `db push`.
- Pas de secret dans le dépôt ; logs sans email ni montant.

## Commandes
(à remplir au fil des étapes : lint, test, build, démarrage dev, migrations)
- Installation : `npm ci` (racine uniquement ; un seul lockfile, workspaces `apps/*`, `packages/*`)
- Build : `npm run build` (tous) ou `npm run build -w @budgetracker/shared` / `-w web`
- Lint : `npm run lint` (ESLint racine, `eslint.config.mjs` ; `apps/web` exclu jusqu'à E14)
- CI : `.github/workflows/ci.yml` = `npm ci` → lint → build → `npm test` → `npm test -w @budgetracker/shared` → `npm test -w api`
- Tests : `npm test` (racine, node:test sur `test/*.test.mjs` ; nécessite `shared` buildé)
- Shared : `npm test -w @budgetracker/shared` (Vitest, `packages/shared/test/*.test.ts`)
- Env dev : `cp .env.example .env` puis `docker compose up -d` (`COMPOSE_FILE` pointe sur docker-compose.dev.yml) ; `docker compose exec db pg_isready`
- BDD (Prisma 7, `apps/api/prisma.config.ts`, lit `.env` racine) : `npm run db:migrate -w api` (deploy) ; `npm run db:reset -w api` (reset + seed, base de dev) ; nouvelle migration : `npx prisma migrate dev --create-only --name x` dans `apps/api`, puis SQL brut si besoin (CHECK, index sur expression, DEFERRABLE). Client généré dans `apps/api/src/generated` (ignoré par git, regénéré par build/pretest)
- API : `npm test -w api` (Jest : `src/**/*.spec.ts` + `test/e2e/*.e2e-spec.ts`) ; `npm run build -w api` puis `npm run start -w api` (lit `.env` racine) → `GET localhost:3000/api/health`

- Auth : `JWT_SECRET` (≥ 32 car.) obligatoire au démarrage ; session en cookies httpOnly, toute requête non GET exige l'en-tête `X-CSRF-Token` = cookie `csrf_token`. Mails de dev : Mailpit http://localhost:8025

## Environnement
- Windows, PowerShell / Git Bash. Docker Desktop requis (Postgres, MinIO, Mailpit).
- Front : conventions dans apps/web/.claude/CLAUDE.md.
