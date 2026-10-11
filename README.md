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
cp .env.example .env        # puis remplacer JWT_SECRET (32 caractères min.)
docker compose up -d        # Postgres, MinIO, Mailpit
npm run build -w @budgetracker/shared
npm run db:migrate -w api   # migrations Prisma (npm run db:reset -w api = reset + seed)
npm run build -w api && npm run start -w api
```

Santé : `GET http://localhost:3000/api/health`. Les e-mails de dev (vérification) arrivent dans Mailpit : http://localhost:8025.

## Commandes

- `npm run lint` — ESLint (racine ; `apps/web` exclu jusqu'à E14)
- `npm run build` — build de tous les workspaces (`-w @budgetracker/shared` / `-w api` / `-w web` pour un seul)
- `npm test` — tests du monorepo (node:test sur `test/*.test.mjs`, nécessite `shared` buildé)
- `npm test -w @budgetracker/shared` — tests de `shared` (Vitest)
- `npm test -w api` — tests de l'API (Jest : unitaires `src/**/*.spec.ts` + e2e `test/e2e/*.e2e-spec.ts`, contre le vrai Postgres)
- `npm run db:migrate -w api` / `npm run db:reset -w api` — migrations / reset + seed de la base de dev

## Authentification (E5)

- Inscription par e-mail + mot de passe (Argon2id), **vérification d'e-mail obligatoire** avant connexion.
- Session : cookies `httpOnly` / `Secure` / `SameSite=Strict` (jamais de jeton dans le corps des réponses ni en `localStorage`), refresh token rotatif avec détection de réutilisation (fenêtre de grâce de 10 s pour les onglets concurrents).
- CSRF en double-submit : toute requête non-GET doit envoyer l'en-tête `X-CSRF-Token` égal au cookie `csrf_token` (posé au premier appel).
- Rate limiting : 5 essais/min par IP sur `signup` et `login`, verrouillage progressif par compte.
- Routes : `POST /api/v1/auth/{signup,verify-email,login,refresh,logout}`, `GET /api/v1/me`.

## État actuel

Avancement selon [PLAN.md](PLAN.md) (32 étapes, E0 à E32) :

| Étape | Statut |
|---|---|
| E0 — Monorepo et environnement | ✅ |
| E1 — Squelette API (config validée, logs masqués, helmet, validation, `/health`) | ✅ |
| E2 — CI minimale (lint, build, tests, service Postgres) | ✅ |
| E3 — Prisma, schéma v1, migration init, seed | ✅ |
| E4 — `shared` : enums, DTO, helpers `money` et `LocalDate` | ✅ |
| E5 — Auth e-mail/mot de passe | ✅ |
| E6 → E32 | ⏳ reset de mot de passe + Google, harnais d'isolation, comptes, catégories, transactions, solde, virements, purge, front, récurrences, intérêts, pièces jointes, stats, simulations, RGPD, déploiement |

Concrètement : l'API gère l'inscription, la connexion et la session, sur un schéma de base complet. Il n'y a pas encore de ressource métier (comptes, transactions). Le front (`apps/web`) est l'ancien code, remplacé en E14.
