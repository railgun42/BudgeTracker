# BudgeTracker

Application web de suivi de transactions financières : historique, statistiques, simulations. SaaS ouvert au public (inscription libre), sans notion de plafond/budget — le terme « budget » désigne ici le suivi, pas une limite.

Hors périmètre v1 : agrégation bancaire / import CSV-OFX, plafonds et alertes, multi-devises, mode hors ligne, 2FA, abonnement payant.

Spécification complète : [SPEC.md](SPEC.md). Déroulé des étapes : [PLAN.md](PLAN.md). Règles de codage : [CLAUDE.md](CLAUDE.md).

## Stack

| Couche | Choix |
|---|---|
| Front | Angular (`apps/web`), mobile-first |
| API | NestJS (TypeScript) |
| BDD | PostgreSQL + Prisma |
| Fichiers | S3 (MinIO en dev, OVH Object Storage en prod) |
| Email | Mailpit en dev, SMTP OVH/Brevo en prod |
| Hébergement | VPS OVH, Docker Compose, Caddy |

Monorepo npm workspaces : `apps/web`, `apps/api`, `packages/shared` (types/enums partagés).

## Prérequis

- Node.js (voir `.nvmrc`/versions dans les `package.json`)
- Docker Desktop (Postgres, MinIO, Mailpit en dev)

## Démarrage

```bash
npm ci
cp .env.example .env
docker compose up -d
docker compose exec db pg_isready
```

## Commandes

- `npm run build` — build de tous les workspaces (`npm run build -w @budgetracker/shared` / `-w web` pour un seul)
- `npm test` — tests du monorepo (node:test sur `test/*.test.mjs`, nécessite `shared` buildé)
- `npm test -w api` — tests de l'API (Jest : unitaires `src/**/*.spec.ts` + e2e `test/e2e/*.e2e-spec.ts`)
- `npm run build -w api` puis `npm run start -w api` — démarre l'API (lit `.env` à la racine) ; `GET http://localhost:3000/api/health`
- `docker compose up -d` — Postgres, MinIO et Mailpit en local (ports liés à 127.0.0.1 uniquement)

## État actuel

Avancement selon [PLAN.md](PLAN.md) (32 étapes, E0 à E32) :

| Étape | Statut |
|---|---|
| E0 — Squelette monorepo et environnement | ✅ fait (commité) |
| E1 — Squelette API | ✅ fait : config d'env validée au démarrage, logger JSON avec masquage des emails/montants, helmet, `ValidationPipe` global, filtre d'erreurs, `GET /api/health`, Jest (15 tests verts) |
| E2 — CI minimale | ⏳ à faire (inclura les tests de l'API dans la CI) |
| E3 → E32 | ⏳ à faire : Prisma, `shared`, auth, comptes, transactions, virements, front, récurrences, intérêts, pièces jointes, stats, simulations, RGPD, déploiement |

Concrètement : l'API démarre et répond sur `/api/health`, mais elle n'a pas encore de base de données, d'authentification ni de ressource métier. Le front (`apps/web`) est l'ancien code, qui sera remplacé en E14.
