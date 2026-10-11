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

## Reset de mot de passe et Google (E6)

- `POST /api/v1/auth/forgot` (202 toujours, pas d'énumération de comptes ; lien valable 30 min, 3 e-mails/heure/compte) puis `POST /api/v1/auth/reset` : lien à usage unique, révoque tous les refresh tokens.
- Google OAuth (code + `state` + PKCE) : `GET /api/v1/auth/google` puis `/google/callback`, qui redirige vers le front. Liaison à un compte existant **uniquement** si l'e-mail Google est vérifié et le compte local vérifié.
- Configuration facultative : `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (URI de redirection : `${APP_URL}/api/v1/auth/google/callback`) ; absents, `/auth/google` répond 404.

## Harnais d'isolation (E7)

Règle : un utilisateur ne voit ni ne modifie jamais les données d'un autre. Chaque route de l'API est soit **publique** (`publicRoutes`), soit associée à un test d'isolation dans `isolationRegistry` ([apps/api/test/helpers/isolation-registry.ts](apps/api/test/helpers/isolation-registry.ts)).

- `createTwoUsers(app)` ([two-users.ts](apps/api/test/helpers/two-users.ts)) : deux utilisateurs vérifiés avec session et CSRF prêts, `a.call('get', url)`.
- Le test méta ([isolation-meta.e2e-spec.ts](apps/api/test/e2e/isolation-meta.e2e-spec.ts)) énumère les routes Nest (`DiscoveryService`) et échoue si une route n'est pas enregistrée, si une entrée est orpheline, ou si la présence de `JwtAuthGuard` contredit le registre.
- **Toute nouvelle route** s'ajoute au registre dans la même étape : B crée la ressource, A la lit/modifie/supprime ⇒ 404, la ressource reste intacte pour B.

## Comptes (E8)

- Routes (toutes authentifiées, préfixe `/api/v1`) : `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id`, `POST /accounts/:id/restore`.
- Trois `trackingType` : `NORMAL`, `WITH_INTEREST`, `NOT_TRACKED` (portefeuille). **Pas de champ solde** : un `balance` en entrée est refusé (400), le solde sera calculé en E11.
- Création avec `openingBalance` facultatif `{ amountCents, date }` (entier ≠ 0, date `YYYY-MM-DD`) : crée, dans la même transaction SQL, une transaction « Solde de départ » (CREDIT si > 0, DEBIT si < 0, catégorie système `opening_balance`). Refusé (422) sur `NOT_TRACKED`.
- Verrou optimiste : `PATCH` exige la `version` lue ; version périmée ⇒ **409**, ressource d'un autre utilisateur ou absente ⇒ **404**.
- Suppression logique (`deletedAt`) : le compte disparaît des listes ; `POST /accounts/:id/restore` l'annule (purge définitive à 30 jours en E13). `DELETE` et `restore` incrémentent la version.
- Code : [apps/api/src/accounts/](apps/api/src/accounts/) ; contrats d'entrée `CreateAccountInput` / `UpdateAccountInput` dans `packages/shared`.

## Catégories et tags (E9)

- Routes (authentifiées, préfixe `/api/v1`) : `GET/POST /categories`, `PATCH/DELETE /categories/:id`, `GET/POST /tags`, `PATCH/DELETE /tags/:id`.
- `GET /categories` renvoie les catégories système (`system: true`, libellé à traduire via `nameKey`) et les catégories perso de l'utilisateur. Système ⇒ `PATCH`/`DELETE` **403**.
- 2 niveaux max : `parentId` doit être une racine (système ou perso) ; sinon **422**. Une catégorie qui a des sous-catégories ne peut pas devenir enfant (422) ni être supprimée (409).
- Suppression d'une catégorie perso utilisée (transactions, y compris supprimées logiquement, ou modèles de récurrence) : `DELETE /categories/:id?reassignTo=<id>` réaffecte puis supprime ; sans cible ⇒ **409**. Catégorie d'un autre utilisateur (cible, parent ou ressource) ⇒ **404**.
- Tags : nom unique par utilisateur sans tenir compte de la casse (**409**) ; suppression physique, les liens aux transactions partent avec.
- Code : [apps/api/src/categories/](apps/api/src/categories/), [apps/api/src/tags/](apps/api/src/tags/) ; contrats dans `packages/shared/src/dto/category.ts`.

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
| E6 — Reset de mot de passe + Google OAuth | ✅ |
| E7 — Harnais d'isolation (`createTwoUsers`, registre, test méta des routes) | ✅ |
| E8 — Comptes (CRUD, 3 `trackingType`, solde de départ, suppression logique + restauration, 409) | ✅ |
| E9 — Catégories (système en lecture seule + perso, 2 niveaux, réaffectation) et tags | ✅ |
| E10 → E32 | ⏳ transactions, solde, virements, purge, front, récurrences, intérêts, pièces jointes, stats, simulations, RGPD, déploiement |

Concrètement : l'API gère l'inscription, la connexion, la session, le reset de mot de passe, la connexion Google, les comptes, les catégories et les tags, sur un schéma de base complet. Un harnais garantit que chaque route a son test d'isolation entre utilisateurs. Pas encore de transactions ni de solde calculé. Le front (`apps/web`) est l'ancien code, remplacé en E14.
