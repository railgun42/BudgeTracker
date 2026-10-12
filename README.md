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

Front (E14-E18) : shell mobile-first avec routes lazy. Client API dans `apps/web/src/app/core/` : `ApiClient` (chemins relatifs à `/api/v1`), intercepteur de session (cookies, 401 ⇒ un seul refresh puis rejeu, 409 ⇒ événement `conflicts`), en-tête CSRF, pipe `eur` et `amountValidator` (centimes via `@budgetracker/shared`). `npm start -w web` proxifie `/api` vers `localhost:3000` (`apps/web/proxy.conf.json`).

Authentification front (E16) : écrans connexion, inscription, vérification d'e-mail (`/verify-email?token=`), mot de passe oublié et reset (`/reset-password?token=`), bouton Google (`apps/web/src/app/features/auth/`). `Session` (`core/auth/session.ts`) garde l'utilisateur dans un signal — jamais de token côté JS, cookies httpOnly uniquement — et `GET /me` est appelé au démarrage (restauration de session + pose du cookie CSRF). `authGuard` protège les écrans métier et redirige vers `/login?returnUrl=…`.

Comptes et transactions front (E17, `apps/web/src/app/features/{accounts,transactions}/`) :
- `/accounts` (`AccountsPage`) : liste des comptes avec solde actuel et, s'il diffère, solde prévisionnel (`GET /accounts/:id/balance`) ; rien pour un compte `NOT_TRACKED`. Même formulaire pour créer et modifier (solde de départ signé à la création, `name`/`trackingType` modifiables avec verrou de `version`). Suppression logique avec bannière « Annuler » (restore), message et bouton « Recharger » sur un 409.
- `/transactions/new` (`TransactionFormPage`) : saisie d'une dépense en **3 champs** (montant, catégorie, compte), date = aujourd'hui, le reste (sens, date, libellé, notes) replié dans un `<details>`. `12,34` est converti en `1234` via `eurosToCents` avant l'envoi ; compte présélectionné s'il n'y en a qu'un.
- `/transfers/new` (`TransferFormPage`) : virement entre comptes ; un compte `NOT_TRACKED` ne peut pas être la source (refus côté UI en plus du 422 serveur) et un avertissement s'affiche pour une cible `NOT_TRACKED` (double comptage assumé, SPEC §3.4).
Historique front (E18, `apps/web/src/app/features/history/`) : `/history` (`HistoryPage`) liste les transactions paginées par curseur (« Charger plus », 50 par page) avec filtres date/compte/catégorie/tag (conservés d'une page à l'autre). Suppression avec bannière « Annuler » (`shared-ui/undo-banner.ts`, restore) ; modification sur place (montant, libellé, date) avec verrou de `version` et message + « Recharger » sur un 409. Les jambes de virement ne se modifient pas ici (supprimer retire les deux).

- `core/today.ts` (jour local `YYYY-MM-DD`) et libellés des catégories système dans `shared-ui/labels.ts` (`categoryLabel`).

Santé : `GET http://localhost:3000/api/health`. Les e-mails de dev (vérification) arrivent dans Mailpit : http://localhost:8025.

## Commandes

- `npm run lint` — ESLint (racine, inclut `apps/web`)
- `npm run build` — build de tous les workspaces (`-w @budgetracker/shared` / `-w api` / `-w web` pour un seul)
- `npm test` — tests du monorepo (node:test sur `test/*.test.mjs`, nécessite `shared` buildé)
- `npm test -w @budgetracker/shared` — tests de `shared` (Vitest)
- `npm test -w api` — tests de l'API (Jest : unitaires `src/**/*.spec.ts` + e2e `test/e2e/*.e2e-spec.ts`, contre le vrai Postgres)
- `npm test -w web` — tests du front (Vitest via `ng test`) ; `npm start -w web` lance le serveur de dev (http://localhost:4200)
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
- Trois `trackingType` : `NORMAL`, `WITH_INTEREST`, `NOT_TRACKED` (portefeuille). **Pas de champ solde** : un `balance` en entrée est refusé (400), le solde est calculé (voir E11).
- Création avec `openingBalance` facultatif `{ amountCents, date }` (entier ≠ 0, date `YYYY-MM-DD`) : crée, dans la même transaction SQL, une transaction « Solde de départ » (CREDIT si > 0, DEBIT si < 0, catégorie système `opening_balance`). Refusé (422) sur `NOT_TRACKED`.
- Verrou optimiste : `PATCH` exige la `version` lue ; version périmée ⇒ **409**, ressource d'un autre utilisateur ou absente ⇒ **404**.
- Suppression logique (`deletedAt`) : le compte disparaît des listes ; `POST /accounts/:id/restore` l'annule (purge définitive à 30 jours, voir E13). `DELETE` et `restore` incrémentent la version.
- Code : [apps/api/src/accounts/](apps/api/src/accounts/) ; contrats d'entrée `CreateAccountInput` / `UpdateAccountInput` dans `packages/shared`.

## Catégories et tags (E9)

- Routes (authentifiées, préfixe `/api/v1`) : `GET/POST /categories`, `PATCH/DELETE /categories/:id`, `GET/POST /tags`, `PATCH/DELETE /tags/:id`.
- `GET /categories` renvoie les catégories système (`system: true`, libellé à traduire via `nameKey`) et les catégories perso de l'utilisateur. Système ⇒ `PATCH`/`DELETE` **403**.
- 2 niveaux max : `parentId` doit être une racine (système ou perso) ; sinon **422**. Une catégorie qui a des sous-catégories ne peut pas devenir enfant (422) ni être supprimée (409).
- Suppression d'une catégorie perso utilisée (transactions, y compris supprimées logiquement, ou modèles de récurrence) : `DELETE /categories/:id?reassignTo=<id>` réaffecte puis supprime ; sans cible ⇒ **409**. Catégorie d'un autre utilisateur (cible, parent ou ressource) ⇒ **404**.
- Tags : nom unique par utilisateur sans tenir compte de la casse (**409**) ; suppression physique, les liens aux transactions partent avec.
- Code : [apps/api/src/categories/](apps/api/src/categories/), [apps/api/src/tags/](apps/api/src/tags/) ; contrats dans `packages/shared/src/dto/category.ts`.

## Transactions (E10)

- Routes (authentifiées, préfixe `/api/v1`) : `GET/POST /transactions`, `GET/PATCH/DELETE /transactions/:id`, `POST /transactions/:id/restore`.
- Création : `accountId`, `categoryId`, `amountCents` (entier > 0, sinon **400**) et `date` (`YYYY-MM-DD`, validée) ; `type` (`DEBIT` par défaut), `name`, `details` et `tagIds` facultatifs. Compte, catégorie ou tag d'un autre utilisateur (ou compte supprimé) ⇒ **404** ; `CREDIT` sur un compte `NOT_TRACKED` ⇒ **422**.
- `PATCH` exige la `version` lue (périmée ⇒ **409**) ; `tagIds` remplace l'ensemble des tags. Le champ `transferId` n'est pas accepté (virements : voir E12) ; modifier directement une jambe de virement ⇒ **422**.
- Liste `GET /transactions` : pagination par curseur opaque (`limit` 1–100, 50 par défaut ; `nextCursor` nul sur la dernière page), tri `(date, id)` décroissant sans doublon ni trou, filtres `from`/`to` (inclusifs), `accountId`, `categoryId` (exacte, sous-catégories exclues), `tagId`.
- Suppression logique : `DELETE` masque la transaction, `POST …/restore` l'annule (purge à 30 jours, voir E13). Les transactions d'un compte supprimé sont masquées, et réapparaissent à la restauration du compte.
- Code : [apps/api/src/transactions/](apps/api/src/transactions/), [cursor.ts](apps/api/src/common/cursor.ts) ; contrats dans `packages/shared/src/dto/transaction.ts`.

## Solde (E11)

- Route (authentifiée) : `GET /api/v1/accounts/:id/balance[?today=YYYY-MM-DD]` → `{ currentCents, forecastCents }`.
- **Actuel** = transactions datées ≤ `today` ; **prévisionnel** = toutes les transactions (futures incluses). CREDIT +, DEBIT −, solde de départ inclus. Supprimées logiquement exclues ; une transaction antidatée change naturellement le solde actuel.
- Un seul `SUM` SQL (`$queryRaw` paramétré) sur l'index `(accountId, date)`, sans charger les lignes ; un test `EXPLAIN` le vérifie.
- Compte `NOT_TRACKED` ⇒ `null` / `null`. Compte d'un autre utilisateur ou supprimé ⇒ **404**.
- `today` est facultatif : c'est le jour du client (évite le décalage de fuseau autour de minuit) ; absent, le jour UTC du serveur est utilisé.
- Code : [apps/api/src/balance/](apps/api/src/balance/) ; contrat `AccountBalanceDto` dans `packages/shared/src/dto/account.ts`.

## Virements (E12)

- Routes (authentifiées, préfixe `/api/v1`) : `POST /transfers`, `GET /transfers/:id`, `PATCH /transfers/:id`. Suppression et restauration : `DELETE /transactions/:id` et `POST /transactions/:id/restore` sur n'importe quelle jambe.
- Un virement = **une opération, deux transactions** (DEBIT sur la source, CREDIT sur la cible) jumelées par `transferId`, en catégorie système `transfer`. `Transfer.version` est le **seul verrou** : `PATCH` (`amountCents`, `date`, `name`, `details`) s'applique aux deux jambes, version périmée ⇒ **409** (de deux PATCH concurrents, un seul passe).
- Suppression d'une jambe ⇒ les deux disparaissent ; restauration ⇒ les deux reviennent (refusée en 404 si l'un des deux comptes est supprimé).
- Vers un compte `NOT_TRACKED` (retrait d'espèces) : une seule jambe DEBIT, catégorie système `cash`, sans `transferId` — dépense ordinaire (réponse avec `id`, `version`, `credit` à `null`).
- Refus : source = cible ou source `NOT_TRACKED` ⇒ **422** ; compte d'un autre utilisateur, inconnu ou supprimé ⇒ **404**.
- Code : [apps/api/src/transfers/](apps/api/src/transfers/) ; contrats dans `packages/shared/src/dto/transfer.ts`.

## Purge des suppressions logiques (E13)

- Job `@nestjs/schedule` ([purge.job.ts](apps/api/src/jobs/purge.job.ts)) : chaque jour à 3 h, supprime définitivement ce qui est supprimé logiquement depuis **plus de 30 jours** (transactions, comptes, récurrences, virements). Aucun endpoint.
- Un virement part **en entier** (Transfer + 2 jambes), y compris quand l'une des jambes est sur un compte purgé (pas de jambe orpheline). La purge d'un compte emporte ses transactions, récurrences et taux (cascade BDD).
- Les occurrences déjà générées par une récurrence purgée sont conservées (`recurrenceId` ⇒ `NULL`).
- `purge(now)` reçoit l'horloge en paramètre (tests : 29 j conservé, 31 j purgé). Les objets S3 seront supprimés en E23.
- `@nestjs/schedule` est en v6 (CommonJS) : la v12 est ESM-only et incompatible avec l'API.

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
| E10 — Transactions (création, édition versionnée, suppression logique + restauration, liste paginée par curseur, filtres, tags) | ✅ |
| E11 — Solde (actuel / prévisionnel par `SUM` SQL indexé, `NOT_TRACKED` ⇒ `null`) | ✅ |
| E12 — Virements (2 jambes, verrou unique, suppression/restauration jumelées, vers portefeuille ⇒ « Espèces ») | ✅ |
| E13 — Purge des suppressions logiques à 30 jours (job quotidien, virements purgés en entier) | ✅ |
| E14 — Front reconstruit (shell mobile-first, routes lazy, tokens) | ✅ |
| E15 — Client API (`ApiClient`, intercepteurs session/CSRF, proxy dev, utilitaires €) | ✅ |
| E16 — Authentification front (connexion, inscription, vérification, reset, Google, `authGuard`) | ✅ |
| E17 — Comptes et saisie de transaction front (liste/CRUD de comptes, dépense en 3 champs, virement) | ✅ |
| E18 — Historique front (pagination par curseur, filtres, annulation, 409) | ✅ |
| E19 → E32 | ⏳ récurrences, intérêts, pièces jointes, stats, simulations, RGPD, déploiement |

Concrètement : l'API gère l'inscription, la connexion, la session, le reset de mot de passe, la connexion Google, les comptes, les catégories, les tags, les transactions, les virements et le calcul du solde, avec purge automatique des suppressions logiques après 30 jours, sur un schéma de base complet. Un harnais garantit que chaque route a son test d'isolation entre utilisateurs. Le front (`apps/web`) permet de s'inscrire, de se connecter, de gérer son mot de passe, de créer/modifier/supprimer ses comptes et de saisir une dépense ou un virement ; de consulter l'historique paginé et filtré, d'annuler une suppression et de corriger une transaction.
