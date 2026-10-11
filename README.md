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
- `npm test` — tests (node:test sur `test/*.test.mjs`, nécessite `shared` buildé)
- `docker compose up -d` — Postgres, MinIO et Mailpit en local (ports liés à 127.0.0.1 uniquement)

## État actuel

Projet au tout début de son implémentation. Seule l'étape **E0 — Squelette monorepo et environnement** (voir [PLAN.md](PLAN.md)) est faite : workspaces npm, package `shared` vide, environnement Docker de dev. Aucune API, aucun schéma de données, aucun écran n'existe encore — tout est à construire étape par étape selon le PLAN.
