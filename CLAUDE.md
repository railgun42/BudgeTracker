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
- Tests : `npm test` (racine, node:test sur `test/*.test.mjs` ; nécessite `shared` buildé)
- Env dev : `cp .env.example .env` puis `docker compose up -d` (`COMPOSE_FILE` pointe sur docker-compose.dev.yml) ; `docker compose exec db pg_isready`

## Environnement
- Windows, PowerShell / Git Bash. Docker Desktop requis (Postgres, MinIO, Mailpit).
- Front : conventions dans apps/web/.claude/CLAUDE.md.
