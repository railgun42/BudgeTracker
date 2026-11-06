# PLAN — BudgeTracker v1

> Dérivé de `SPEC.md` (v1 validée) et d'un état des lieux du dépôt (front existant ignoré, reconstruit de zéro). Aucun code n'est écrit à ce stade.
> Mise à jour après essai local : étapes E30 à E43 insérées avant le déploiement (ancien E30 à E32, devenu E44 à E46) ; la SPEC a été révisée en conséquence (§13 ajouté). **Les numéros suivent l'ordre d'exécution.**
> Convention : « Vérif » = commande ou test qui doit passer avant de passer à l'étape suivante. Une étape = un commit (ou une courte série).

## 0. Contexte

Le dépôt contient aujourd'hui un front Angular 21 (`apps/web`) réalisé sans grande profondeur : il simule tout en local (`localStorage`, mots de passe en SHA-256 sans sel, montants décimaux, connexion par username). **Décision : on ignore ce code existant ; le front est reconstruit de zéro** (aucune migration, aucun audit, aucune réutilisation de ses modèles/services/pages). La spec demande un vrai SaaS : API NestJS + PostgreSQL + Prisma, auth sécurisée, récurrences/intérêts côté serveur, pièces jointes S3, stats, simulations, RGPD, exploitation.
Le plan suit le découpage de la SPEC §11, avec une étape 0 de fondations et des écarts assumés (voir §7).

### Ce qu'on garde de l'existant (et rien d'autre)
| Élément | Pourquoi |
|---|---|
| Outillage Angular 21 de `apps/web` (`angular.json`, `tsconfig*`, Vitest, Prettier) | Gain de temps, aucun code métier dedans |
| `apps/web/.claude/CLAUDE.md` (conventions : standalone, signals, OnPush, formulaires réactifs, `@if/@for`, AXE/WCAG AA) | Conventions de code du nouveau front |
| `docs/wireframes/*.drawio` et `docs/diagrams/classDiagram.puml` | Intentions d'écrans ; à relire pour guider l'UI, **sans** les suivre s'ils contredisent la SPEC |
| Tout le reste de `apps/web/src/app` | **Supprimé en E14** |

Si l'outillage s'avère gênant, `ng new` dans un dossier propre est un repli équivalent.

## 1. Architecture

**Monolithe modulaire NestJS** (pas de microservices), un seul PostgreSQL, Caddy en frontal : `/` sert le build Angular, `/api/*` proxifié vers Nest → **même origine**, donc cookies `SameSite=Strict/Lax` sans CORS en prod.

```
Navigateur ── HTTPS ──> Caddy ──> /api/*  ──> NestJS ──> PostgreSQL (réseau Docker interne, non exposé)
                         │                      ├──> OVH Object Storage (S3, URLs signées)
                         └──> / (Angular statique)└──> SMTP (OVH / Brevo / Resend)
```

Règles d'architecture (vérifiables par lint/tests) :
1. **Moteurs purs** : `recurrences/engine`, `interest/engine`, `simulations/engine` n'importent ni Nest ni Prisma (règle ESLint `no-restricted-imports`). Entrées/sorties = données simples → testables sans BDD (SPEC §6, §10).
2. **Isolation** : tout accès BDD d'une ressource métier passe par un `where: { userId }` ; un test méta liste toutes les routes Nest et échoue si l'une n'a pas son test d'isolation (E7).
3. **Frontière de sérialisation** : Prisma `BigInt` → `number` (centimes, sûr jusqu'à 9·10¹⁵) et `Date @db.Date` → `'YYYY-MM-DD'` dans un seul mapper ; jamais de `BigInt`/`Date` dans les DTO.
4. **Types partagés** = interfaces + enums string + helpers `money`/`localDate` dans `packages/shared`. Aucune donnée d'authentification dedans.
5. Validation : `class-validator` + `ValidationPipe({ whitelist, forbidNonWhitelisted })` sur chaque DTO.

## 2. Arborescence cible

```
BudgeTracker/
├─ package.json                  # npm workspaces: apps/*, packages/*  (scripts: lint, test, build)
├─ docker-compose.yml            # prod : caddy, api, web(static), db
├─ docker-compose.dev.yml        # postgres + minio (S3 local) + mailpit
├─ .env.example                  # aucune valeur secrète
├─ .github/workflows/ci.yml
├─ SPEC.md  PLAN.md
├─ docs/                         # existant (diagrams, wireframes) + privacy/ + runbook-backup.md
├─ deploy/
│  ├─ Caddyfile
│  └─ backup/{backup.sh,restore.sh}
├─ packages/shared/
│  └─ src/{enums.ts,dto/*.ts,money.ts,local-date.ts,index.ts}
├─ apps/api/
│  ├─ Dockerfile
│  ├─ prisma/{schema.prisma,migrations/,seed.ts}
│  ├─ src/
│  │  ├─ main.ts  app.module.ts
│  │  ├─ config/            # validation des variables d'env
│  │  ├─ common/            # guards (JWT, CSRF), @CurrentUser, filtres d'erreur, mapper BigInt/Date, curseur, redaction des logs
│  │  ├─ prisma/            # PrismaService
│  │  ├─ auth/  users/  mail/
│  │  ├─ accounts/  categories/  tags/
│  │  ├─ transactions/  transfers/  balance/
│  │  ├─ recurrences/{engine/,…}   interest/{engine/,…}
│  │  ├─ attachments/  storage/
│  │  ├─ stats/
│  │  ├─ simulations/{engine/,…}   scenarios/
│  │  ├─ gdpr/              # export + suppression de compte
│  │  ├─ jobs/              # @nestjs/schedule : purge, récurrences, intérêts
│  │  └─ health/
│  └─ test/{e2e/,helpers/}  # createTwoUsers(), registre d'isolation
└─ apps/web/                   # reconstruit de zéro (seul l'outillage Angular est conservé)
   └─ src/app/{core/(api-client, interceptors, auth),shared-ui/,features/{auth,accounts,transactions,history,…}}
```

## 3. Modèle de données (PostgreSQL via Prisma)

Conventions : ids `uuid` ; `createdAt/updatedAt` UTC ; montants `amountCents BIGINT` ; jour = `DATE` ; `version Int @default(1)` sur les entités modifiables ; `deletedAt` sur Transaction/Account/Recurrence. Chaque table métier porte `userId`.

| Entité | Colonnes clés | Contraintes / index |
|---|---|---|
| **User** | id, email, emailVerifiedAt, name, lastConnection, storageQuotaBytes (déf. 200 Mo) | `email` unique (normalisé minuscule). Pas de `phoneNumber` |
| **Credential** | userId (unique), passwordHash (Argon2id, nullable si Google seul) | jamais exposé, hors `shared` |
| **OAuthIdentity** | userId, provider, providerId | unique (provider, providerId) |
| **EmailToken** | userId, type `VERIFY`/`RESET`, tokenHash, expiresAt, usedAt | usage unique ; seul le hash est stocké |
| **RefreshToken** | userId, familyId, tokenHash, expiresAt, revokedAt | rotation ; réutilisation d'un ancien token ⇒ révocation de la famille |
| **Account** | name, trackingType (`NORMAL`/`NOT_TRACKED`/`WITH_INTEREST`), currency='EUR', version, deletedAt | index (userId, deletedAt). **Pas de solde** |
| **Transfer** | id, userId, version, deletedAt | porte la version/le verrou unique des deux jambes |
| **Transaction** | accountId, name, date (DATE), amountCents, type (`DEBIT`/`CREDIT`), details, categoryId, transferId?, recurrenceId?, occurrenceDate?, version, deletedAt | `CHECK (amountCents > 0)` (SQL brut dans la migration) ; index (accountId, date) ; index (userId, date DESC, id) pour la pagination curseur ; **unique (recurrenceId, occurrenceDate)**, non partiel (les lignes supprimées logiquement comptent) |
| **Category** | userId? (NULL = système), parentId?, nameKey? (système, traduisible), name? (perso), color | 2 niveaux max (parent doit être racine, vérifié en service) ; système non modifiable/supprimable ; perso : suppression = réaffectation préalable |
| **Tag** / **TransactionTag** | userId, name | unique (userId, lower(name)) |
| **Attachment** | userId, transactionId (unique ⇒ 0..1, **nullable** : document déposé dans le coffre), s3Key, originalName (affichage seul), mime, sizeBytes | quota = `SUM(sizeBytes)` par utilisateur |
| **AttachmentTag** | attachmentId, tagId | PK composite, cascade des deux côtés (E41b) |
| **Recurrence** | accountId, interval, unit (`DAY`/`WEEK`/`MONTH`/`YEAR`), startDate, endDate?, anchorDay, lastGeneration?, version, deletedAt | |
| **TransactionTemplate** | recurrenceId (1-1), name, amountCents, type, categoryId, details, tags | lu **au moment de la génération** ⇒ « futur seulement » par défaut ; `scope: 'all'` réécrit aussi les occurrences passées non supprimées (SPEC §3.6, amendée le 2026-10-15) |
| **InterestRate** | accountId, rateBp (taux annuel en points de base), effectiveDate | unique (accountId, effectiveDate) |
| **InterestCredit** | accountId, year, transactionId | **unique (accountId, year)** ⇒ idempotence du 31/12 |
| **Scenario** | userId, name, params (JSON), version | `params` validé par un DTO union discriminée, pas du JSON libre |

Catégories système seedées : *Intérêts*, *Espèces*, *Solde de départ* + un jeu de catégories de base (reprendre Divertissement/Sport/Courses/Logement du front).

### Surface d'API (préfixe `/api/v1`)
`auth/{signup,verify-email,login,refresh,logout,forgot,reset,google}` · `me` · `accounts` · `categories` · `tags` · `transactions` (+`?cursor&limit=50&from&to&categoryId&tagId&accountId`) · `transfers` · `accounts/:id/balance` · `recurrences` · `accounts/:id/interest-rates` · `transactions/:id/attachment` · `stats/{by-category,by-tag,monthly}` · `simulations/{projection,savings-goal,loan,investment}` · `scenarios` (+`/compare`) · `me/export` · `DELETE me` · `health`.

## 4. Étapes ordonnées

### Suivi : ce qu'il reste à faire, dans l'ordre

E0 à E43b sont terminées (E43 cochée le 2026-11-06 avec la fin d'E43b) ; prochaine étape : E43c (liste des utilisateurs, ajoutée le 2026-11-06), puis E44. E42 est décrite (SPEC §7) et découpée en E42a à E42c. **Les numéros suivent l'ordre d'exécution** : on prend la première ligne non terminée dont les dépendances sont faites.

| Étape | Sujet | Dépend de |
|---|---|---|
| E30 | Transactions antérieures au solde de départ | — |
| E31 | Catégorie puis sous-catégorie, facultatives | — |
| E32 | Page 404 : libellé du bouton de retour | — |
| E33 | Simulation de trésorerie : moteur et API | — |
| E34 | Plafond minimum et enveloppe dépensable | E33 |
| E35 | Simulation : interface | E34 |
| E36 | Catégories personnalisables par l'utilisateur | E31 |
| E37 | Rôle administrateur et statistiques | — |
| E38 | Administration : catégories globales | E37 |
| E39 | Retours utilisateurs et boîte de réception admin | E37 |
| E40 | Notifications (cloche) et annonces | E37 |
| E41 | Suggestion de catégorie et réponse à l'auteur | E36, E38, E40 |
| E41c | Champ tags en puces dans la saisie de transaction (R-2) | E41b |
| E41d | Modification complète d'une transaction dans l'historique (R-1) | E41c |
| E42a | Tableau de bord : API (préférences, série de soldes, échéances) | E30, E31, E34 |
| E42b | Tableau de bord : socle, chiffres clés, alertes, personnalisation | E42a |
| E42c | Tableau de bord : courbe du solde, dernières transactions, donut | E42b |
| E43 | Refonte du style (inclut R-3, R-4, R-5 de `docs/remarques.md`) | toutes les fonctionnalités (E30 à E41d, et E42a à E42c) |
| E43b | Corrections issues de l'audit navigateur d'E43 (D1 à D4, R-3/R-5 à confirmer) | E43 |
| E43c | Administration : liste des utilisateurs, offre premium et quota (SPEC §13.7) | E43b |
| E44 | Conteneurs et déploiement (début du passage au serveur OVH) | E43c |
| E45 | Sauvegardes | E44 |
| E46 | Supervision et check-list de lancement | E45 |

Prompt type pour chaque session (une étape = une session neuve = un commit) :
> Lis SPEC.md, PLAN.md et les règles. Implémente uniquement l'étape E__ . Ne touche pas aux autres étapes. Écris les tests correspondants, lance-les ainsi que le build, et corrige jusqu'à ce que tout passe. Montre-moi la sortie des tests comme preuve.


### Phase 0 — Fondations

**E0 — Squelette monorepo et environnement**
- Objectif : racine `npm workspaces`, `packages/shared` vide, Postgres/MinIO/Mailpit en dev, `.env.example`. Prérequis utilisateur : **installer Docker Desktop** (absent aujourd'hui).
- Fichiers : `package.json` (racine), `packages/shared/{package.json,tsconfig.json,src/index.ts}`, `docker-compose.dev.yml`, `.env.example`, `.gitignore`, `apps/web/package.json` (déclaré workspace, code applicatif non touché avant E14).
- Vérif : `npm ci && npm run build -w @budgetracker/shared && npm run build -w web` (le front existant compile encore tel quel) ; `docker compose -f docker-compose.dev.yml up -d db && docker compose exec db pg_isready`. Le point de contrôle de packaging de `shared` côté Angular est fait en E14 ; côté Nest en E1 (voir risque R1).

**E1 — Squelette API**
- Objectif : app Nest avec config validée au démarrage, logger JSON avec redaction (email, montants), `helmet`, `ValidationPipe` global, filtre d'erreurs, `GET /api/health`, Jest.
- Fichiers : `apps/api/{package.json,tsconfig*.json,nest-cli.json,src/main.ts,app.module.ts,config/*,common/*,health/*}`, `test/e2e/health.e2e-spec.ts`.
- Vérif : `npm test -w api` ; `curl localhost:3000/api/health` → 200 ; test qui vérifie qu'un log contenant un email est masqué ; démarrage refusé si une variable d'env obligatoire manque.

**E2 — CI minimale (avancée)**
- Objectif : lint + tests + build à chaque push, avec service Postgres. Le build d'images Docker est ajouté à E44.
- Fichiers : `.github/workflows/ci.yml`, ESLint racine (dont la règle de pureté des `engine/`).
- Vérif : workflow vert sur une PR ; une violation volontaire de `no-restricted-imports` dans un `engine/` le fait échouer.

**E3 — Prisma, schéma v1, première migration, seed**
- Objectif : tout le §3 en un schéma + migration versionnée, `CHECK (amountCents > 0)`, seed des catégories système.
- Fichiers : `apps/api/prisma/{schema.prisma,migrations/*,seed.ts}`, `src/prisma/*`, `test/helpers/db.ts`.
- Vérif : `npx prisma migrate reset --force` OK ; test d'intégration : insérer un montant ≤ 0 échoue, insérer deux fois `(recurrenceId, occurrenceDate)` échoue, deux comptes de même email échouent.

**E4 — `shared` : enums, DTO, helpers**
- Objectif : enums string (`TrackingType`, `TransactionType`, `IntervalUnit`), interfaces DTO, `eurosToCents`/`centsToEuros`/`formatEur`, utilitaires `LocalDate` (ajout de jours/mois, dernier jour du mois).
- Fichiers : `packages/shared/src/*` + tests Vitest.
- Vérif : `npm test -w @budgetracker/shared` : `eurosToCents('12,34') === 1234`, `0.1+0.2` ne dérive pas, rejet de `'1e3'`, `lastDayOfMonth('2024-02')==='29'`.

### Phase 1 — API cœur (SPEC §11.1)

**E5 — Auth e-mail/mot de passe**
- Objectif : inscription, vérification d'e-mail obligatoire, login (Argon2id), cookies httpOnly+Secure+SameSite, refresh rotatif avec détection de réutilisation, logout, protection CSRF (en-tête `X-CSRF-Token` en double-submit), `@nestjs/throttler` par IP et par compte avec verrouillage progressif, module mail (transport console/Mailpit en dev).
- Fichiers : `src/auth/*`, `src/users/*`, `src/mail/*`, `src/common/{jwt-auth.guard,csrf.guard}.ts`, `test/e2e/auth.e2e-spec.ts`.
- Vérif : e2e — signup→mail capturé→verify→login→`GET /me` 200 ; login non vérifié 403 ; mot de passe faux 401 ; 6ᵉ essai rapide 429 ; refresh renvoie un nouveau token et l'ancien rejoué révoque la famille ; `POST` sans CSRF 403 ; aucun token dans le corps de réponse.

**E6 — Reset de mot de passe + Google OAuth**
- Objectif : lien de reset à usage unique et expiration courte ; OAuth Google ; liaison de comptes **uniquement** si l'e-mail Google est vérifié et correspond à un compte existant vérifié.
- Fichiers : `src/auth/{password-reset,google}.*`, tests.
- Vérif : e2e — token réutilisé 400, token expiré 400, reset révoque tous les refresh tokens ; tests unitaires de la stratégie Google avec profil simulé : e-mail non vérifié ⇒ refus de liaison.

**E7 — Harnais d'isolation (avant toute ressource métier)**
- Objectif : helper `createTwoUsers()` + registre `isolationRegistry` + **test méta** qui énumère les routes (Nest `DiscoveryService`/`RouterExplorer`) et échoue si une route authentifiée n'a pas d'entrée.
- Fichiers : `test/helpers/{two-users.ts,isolation-registry.ts}`, `test/e2e/isolation-meta.e2e-spec.ts`.
- Vérif : le test méta échoue quand on ajoute une route bidon, passe une fois la route enregistrée. Chaque étape suivante ajoute ses routes au registre.

**E8 — Comptes**
- Objectif : CRUD, 3 `trackingType`, solde de départ (crée la transaction « Solde de départ »), suppression logique + restauration, `version` ⇒ 409.
- Fichiers : `src/accounts/*`, tests.
- Vérif : e2e — A ne voit/modifie/supprime pas les comptes de B (404) ; PATCH avec mauvaise `version` ⇒ 409 ; compte supprimé absent des listes puis restauré ; DTO refuse un champ `balance`.

**E9 — Catégories et tags**
- Objectif : catégories système en lecture seule + perso, 2 niveaux max, suppression perso avec réaffectation obligatoire, système non supprimable ; tags par utilisateur.
- Fichiers : `src/categories/*`, `src/tags/*`, tests.
- Vérif : e2e — création d'un 3ᵉ niveau 422 ; suppression d'une catégorie utilisée sans cible 409/422 ; avec cible, transactions réaffectées ; PATCH/DELETE d'une catégorie système 403 ; catégorie perso de B inutilisable par A.

**E10 — Transactions**
- Objectif : création (3 champs minimum, date par défaut = aujourd'hui côté client, validée côté serveur), édition versionnée, suppression logique/restauration, liste paginée par curseur (50), filtres date/catégorie/tag/compte, tags.
- Fichiers : `src/transactions/*`, `src/common/cursor.ts`, tests.
- Vérif : e2e — 120 transactions ⇒ 3 pages sans doublon ni trou, y compris dates égales (tri `(date, id)`) ; `accountId`/`categoryId`/`tagId` appartenant à un autre utilisateur ⇒ 404 ; `amountCents: 0`, `1.5`, négatif ⇒ 400 ; 409 sur version périmée.

**E11 — Solde**
- Objectif : solde actuel (`date <= today`) et prévisionnel (toutes dates) par `SUM` SQL ; `NOT_TRACKED` ⇒ pas de solde.
- Fichiers : `src/balance/*`, tests.
- Vérif : transaction antidatée change le solde actuel ; transaction future change seulement le prévisionnel ; compte `NOT_TRACKED` renvoie `null` ; supprimée logiquement ⇒ exclue ; `EXPLAIN` du SUM utilise l'index `(accountId, date)`.

**E12 — Virements**
- Objectif : une opération = deux transactions liées par `transferId`, un seul verrou (`Transfer.version`) ; modifier/supprimer une jambe applique aux deux ; virement vers `NOT_TRACKED` = une seule jambe DEBIT catégorie « Espèces » comptée comme dépense.
- Fichiers : `src/transfers/*`, `src/transactions/*` (refuse la modification directe d'une jambe), tests.
- Vérif : e2e — créer ⇒ 2 lignes, soldes −x/+x ; supprimer une jambe supprime les deux ; deux PATCH concurrents sur la même version ⇒ un 200, un 409 ; virement vers portefeuille ⇒ 1 ligne, catégorie Espèces ; source = cible refusée ; comptes d'utilisateurs différents refusés.

**E13 — Purge des suppressions logiques**
- Objectif : job `@nestjs/schedule` qui supprime définitivement après 30 jours (transactions, comptes, récurrences, jambes de virement ensemble).
- Fichiers : `src/jobs/purge.job.ts`, tests.
- Vérif : horloge injectée — supprimé il y a 29 j conservé, il y a 31 j purgé ; virement purgé en entier ; la purge d'un compte emporte ses transactions.

### Phase 2 — Front reconstruit (SPEC §11.2)

L'ancien front est ignoré : pas d'audit ni de migration. On repart d'un front vide branché sur l'API réelle, sans aucune logique métier ni stockage local.

**E14 — Remise à zéro du front et socle**
- Objectif : supprimer le contenu de `apps/web/src/app` (pages, modèles, services, guard, enums), garder l'outillage ; créer un shell (layout mobile-first, navigation, routes lazy, styles/tokens de base, page 404) ; consommer `shared` ; lire `docs/wireframes/*` pour fixer la liste des écrans.
- Fichiers : `apps/web/src/app/{app.*,app.routes.ts,core/,shared-ui/}`, `apps/web/src/styles.scss` ; suppression de `models/ enums/ services/ guards/ pages/ components/` anciens.
- Vérif : `npm run build -w web` et `npm test -w web` verts ; le shell importe un enum de `@budgetracker/shared` et compile (valide R1 côté Angular) ; `git ls-files apps/web/src/app | grep -E "user-service|auth-service|models/"` ne renvoie rien.

**E15 — Client API**
- Objectif : `ApiClient`, intercepteurs (cookies `withCredentials`, en-tête CSRF, sur 401 un seul refresh puis rejeu, 409 ⇒ événement « conflit »), `proxy.conf.json` vers l'API, utilitaires € ⇄ centimes de `shared` pour tous les montants affichés/saisis.
- Fichiers : `apps/web/src/app/core/*`, `proxy.conf.json`, `angular.json`.
- Vérif : tests Vitest des intercepteurs (401→refresh→rejeu une seule fois ; 409 émis ; en-tête CSRF présent sur POST/PATCH/DELETE).

**E16 — Authentification**
- Objectif : écrans connexion par e-mail, inscription (e-mail + nom), vérification d'e-mail, mot de passe oublié/reset, bouton Google ; `AuthGuard` basé sur `GET /me` ; état de session en signal, jamais de token côté JS.
- Fichiers : `features/auth/*`, `core/auth/*`.
- Vérif : tests de composants ; `grep -rn "localStorage\|sessionStorage\|crypto.subtle" apps/web/src` ne renvoie rien d'auth ; parcours manuel complet contre l'API locale (mail dans Mailpit).

**E17 — Comptes et saisie de transaction**
- Objectif : liste/création/édition/suppression-annulation de comptes (3 types, solde de départ, `NOT_TRACKED` sans solde), saisie d'une dépense en **3 champs** (montant, catégorie, compte ; date = aujourd'hui, détails optionnels), formulaire de virement.
- Fichiers : `features/{accounts,transactions}/*`.
- Vérif : tests de composants ; création d'une dépense en 3 champs puis solde mis à jour dans l'UI ; saisie de `12,34` envoie `1234` ; formulaires avec libellés et navigation clavier.

**E18 — Historique**
- Objectif : liste avec pagination par curseur (50, « charger plus »), filtres date/catégorie/tag/compte, bannière « Annuler » après suppression, message clair sur 409 avec « Recharger ».
- Fichiers : `features/history/*`, composant `undo-banner`.
- Vérif : tests de composants (annuler restaure ; 409 affiche le message ; filtres envoyés à l'API) ; `ng test` et `ng build` verts.

### Phase 3 — Récurrences puis intérêts (SPEC §11.3)

**E19 — Moteur de dates de récurrence (pur)**
- Objectif : `occurrencesBetween(rule, from, to)` avec jour d'ancrage (31 ⇒ dernier jour des mois courts sans dérive), DAY/WEEK/MONTH/YEAR, `interval`, `endDate`.
- Fichiers : `src/recurrences/engine/*.ts`, `*.spec.ts`.
- Vérif : tests — 31/01 → 28/02 → 31/03 → 30/04 ; 29/02 annuel → 28/02 les années non bissextiles puis 29/02 ; intervalle 2 semaines ; rattrapage de 14 mois ; `endDate` inclusive ; résultat identique quel que soit le découpage de la fenêtre.

**E20 — Récurrences : API et génération serveur**
- Objectif : CRUD recurrence+template, génération idempotente (`INSERT … ON CONFLICT DO NOTHING` + verrou consultatif par récurrence + avancement de `lastGeneration`), job quotidien, rattrapage à la connexion, édition d'une occurrence isolée, suppression d'une occurrence passée non régénérée, modification du template = futur seulement. UI minimale côté front.
- Fichiers : `src/recurrences/*`, `src/jobs/recurrence.job.ts`, `apps/web/src/app/features/recurrences/*`, tests.
- Vérif : **critère clé de la SPEC** — 20 appels `generate()` simultanés ⇒ exactement N lignes ; absent 1 mois ⇒ toutes les occurrences dues à la connexion ; occurrence passée supprimée ⇒ pas recréée, **même après purge des 30 jours** ; changer le montant ne modifie aucune transaction passée.

**E21 — Moteur d'intérêts (pur)**
- Objectif : `yearlyInterest(dailyBalances, rates, year)` : quinzaines, solde minimum, taux/24, arrondi au centime, taux historisé par date d'effet.
- Fichiers : `src/interest/engine/*.ts`, `*.spec.ts`.
- Vérif : cas calculés à la main dans le test (solde constant ⇒ ≈ taux × solde ; retrait en milieu de quinzaine ⇒ minimum retenu) ; changement de taux en cours d'année ; taux absent ⇒ résultat « non calculable ».

**E22 — Intérêts : job et UI**
- Objectif : endpoints de taux, job du 31/12 (et rattrapage) qui crée une transaction CREDIT « Intérêts » idempotente via `InterestCredit(accountId, year)` ; signalement « taux manquant » dans l'UI.
- Fichiers : `src/interest/*`, `src/jobs/interest.job.ts`, pages comptes front.
- Vérif : exécuter le job deux fois ⇒ une seule transaction ; deux exécutions simultanées ⇒ une seule ; sans taux ⇒ rien créé et indicateur remonté par l'API ; compte non `WITH_INTEREST` ignoré.

### Phase 4 — Pièces jointes (SPEC §11.4)

**E23 — Pièces jointes**
- Objectif : upload (JPEG/PNG/WebP/PDF, 5 Mo), détection par signature de fichier, clé S3 générée serveur (nom d'origine jamais utilisé comme chemin), URL signée courte, quota par utilisateur (`User.storageQuotaBytes`), suppression avec la transaction purgée. UI d'upload sur la transaction.
- Fichiers : `src/storage/*`, `src/attachments/*`, `apps/web/src/app/features/transactions/*` (upload), tests.
- Vérif : PDF renommé `.png` accepté comme PDF et exécutable renommé `.png` rejeté ; 5 Mo + 1 octet ⇒ 413 ; dépassement de quota refusé ; 2ᵉ pièce sur une transaction refusée ; URL d'une pièce d'un autre utilisateur ⇒ 404 ; contre MinIO : l'objet existe après upload et disparaît à la purge.

### Phase 5 — Statistiques (SPEC §11.5)

**E24 — Statistiques**
- Objectif : répartition par catégorie et par tag, évolution mensuelle revenus/dépenses, par compte ou global, en SQL agrégé (`$queryRaw` paramétré) ; exclusion des jambes de virement ; virement « Espèces » compté en dépense ; comptes `NOT_TRACKED` : dépenses seulement. Page front avec graphiques simples (SVG/CSS ; librairie seulement si insuffisant).
- Fichiers : `src/stats/*`, `apps/web/src/app/features/stats/*`, tests.
- Vérif : jeu de données connu ⇒ totaux exacts au centime ; virement interne absent ; retrait d'espèces présent ; transactions supprimées logiquement exclues ; un autre utilisateur n'apparaît jamais dans les agrégats.

### Phase 6 — Simulations (SPEC §11.6)

**E25 — Calculateurs crédit et placement (purs)**
- Fichiers : `src/simulations/engine/{loan,investment}.ts`, specs, endpoints sans accès BDD.
- Vérif : mensualité d'un prêt de référence (valeurs connues, ex. 10 000 € / 5 % / 60 mois ≈ 188,71 €), taux 0 %, coût total = mensualités − capital, intérêts composés avec/sans inflation.

**E26 — Projection du solde et objectifs d'épargne (purs)**
- Fichiers : `src/simulations/engine/{projection,savings-goal}.ts`, `simulations.service.ts`, specs.
- Vérif : projection = solde + récurrences futures + rythme moyen des dépenses non récurrentes sur 3 mois (paramètre) ; fenêtre vide ⇒ rythme 0 ; objectif « X € dans N mois » ⇒ effort mensuel et progression ; virements exclus du rythme.

**E27 — Scénarios « et si » et comparaison**
- Objectif : `Scenario` sauvegardé, appliqué à une copie virtuelle, comparaison côte à côte ; page front.
- Fichiers : `src/scenarios/*`, `src/simulations/engine/scenario.ts`, `apps/web/src/app/features/simulations/*`.
- Vérif : exécuter un scénario laisse inchangé le nombre de lignes de toutes les tables (test sur comptage avant/après) ; paramètres invalides ⇒ 400 ; scénario de B inaccessible à A ; comparer deux scénarios ⇒ deux séries.

### Phase 7 — RGPD, légal, exploitation (SPEC §11.7)

**E28 — Export et suppression de compte**
- Objectif : export JSON et CSV de toutes les données de l'utilisateur ; suppression réelle (cascade BDD + objets S3 + sessions).
- Fichiers : `src/gdpr/*`, UI « Mon compte », tests.
- Vérif : l'export contient toutes les entités de l'utilisateur et aucune d'un autre ; après `DELETE /me`, un comptage SQL sur **toutes** les tables portant `userId` donne 0, les clés S3 n'existent plus, les cookies sont invalidés.

**E29 — Pages légales**
- Objectif : mentions légales, politique de confidentialité, CGU (hébergeur OVH, contact, finalités, durées : suppressions logiques 30 j, sauvegardes 30 j, limite « l'administrateur peut techniquement lire les données »). Liens dans le pied de page et à l'inscription.
- Fichiers : `apps/web/src/app/features/legal/*`, `docs/privacy/*`.
- Vérif : trois routes publiques accessibles sans connexion ; case de consentement CGU requise à l'inscription ; **contenu à fournir/valider par l'éditeur** (identité, adresse, contact).

**E29b — Consentement CGU côté serveur (inscription e-mail)**
- Objectif : preuve et contrôle serveur du consentement, aujourd'hui vérifié seulement dans le navigateur (E29). `SignupDto.acceptTerms` obligatoire (`true`), colonne `User.termsAcceptedAt` (+ `termsVersion`) via migration Prisma versionnée, le front envoie le champ.
- Fichiers : `apps/api/src/auth/{auth.dto.ts,auth.service.ts}`, `apps/api/prisma/migrations/*`, `apps/web/src/app/features/auth/signup-page.ts`, tests e2e et front adaptés.
- Vérif : e2e — signup sans `acceptTerms` ou avec `false` ⇒ 400 et aucun compte créé ; avec `true` ⇒ `termsAcceptedAt` renseigné ; l'export (E28) et la suppression de compte couvrent la nouvelle colonne ; test front : le corps envoyé contient `acceptTerms: true`.

**E29c — Consentement CGU pour l'inscription Google**
- Objectif : plus de création de compte Google sans consentement. Défaut retenu : **option B**, cookie court posé par le front quand la case est cochée, exigé par le callback Google pour tout *nouveau* compte (la connexion d'un compte existant n'est pas concernée) et enregistré dans `termsAcceptedAt`. Repli plus lourd : option C (compte « en attente » + page de consentement).
- Fichiers : `apps/api/src/auth/google.controller.ts` (et la création de compte associée), `common/cookies.ts`, `apps/web/src/app/features/auth/signup-page.ts`, tests.
- Vérif : e2e/unitaires avec profil Google simulé — nouveau compte sans cookie de consentement ⇒ refus (redirection `/login?error=…`, aucun compte créé) ; avec cookie ⇒ compte créé et `termsAcceptedAt` renseigné ; compte existant ⇒ connexion sans cookie ; cookie `httpOnly`/`Secure`/`SameSite=Lax`, durée ≤ 10 min.
- Prérequis : E29b (colonne `termsAcceptedAt`). Les deux étapes sont à terminer avant l'ouverture publique (cochées dans la check-list E46).

### Phase 8 — Évolutions demandées après essai local (SPEC §3.2, §3.3, §6)

> Issues d'un essai manuel de l'application. Une étape = une session = un commit. Ordre : E30 → E31 → E32 (indépendantes entre elles), puis E33 → E34 → E35 (chacune dépend de la précédente). La SPEC est déjà révisée ; une étape qui s'en écarte corrige la SPEC dans le même commit.

**E30 — Transactions antérieures au solde de départ**
- Objectif : l'utilisateur saisit son solde actuel à la création du compte, puis recopie l'historique de sa banque pour avoir des statistiques. Ces transactions, **antérieures à la date de la transaction « Solde de départ »**, sont déjà comprises dans le solde saisi : elles comptent dans l'historique et les stats, **pas dans le solde** (actuel ni prévisionnel). À la **même date** que le solde de départ, l'API exige un choix explicite (compter ou non) ; le front pose la question à la saisie. Prévoir le comportement si la date du solde de départ est modifiée ou si cette transaction est supprimée/restaurée.
- Fichiers : `src/balance/*`, `src/transactions/*` (drapeau explicite pour le jour même, migration versionnée si colonne), `src/accounts/*`, `features/transactions/*`, SPEC §3.3, tests.
- Vérif : e2e — transaction à J-1 du solde de départ : solde inchangé, présente dans l'historique et dans les stats ; à J+1 : solde modifié ; au jour J sans choix ⇒ 400, avec choix ⇒ comptée ou non selon la valeur ; `EXPLAIN` du SUM utilise toujours l'index `(accountId, date)`. Décision à confirmer en début d'étape : virement antérieur au solde de départ (par défaut : même règle, jambe par jambe).

**E31 — Catégories : catégorie puis sous-catégorie, facultatives**
- Objectif : le modèle a déjà 2 niveaux ; on change l'usage. Formulaires avec **deux listes liées** (catégorie, puis sous-catégorie filtrée), **toutes deux facultatives** ⇒ `categoryId` nullable sur `Transaction` et `TransactionTemplate` (migration versionnée). Seed revu : catégories générales avec sous-catégories précises (ex. Sport → abonnement, licence, séance ; Courses → alimentaire, vêtements ; Divertissement → jeux vidéo, multimédia/cinéma/streaming…). Les catégories système techniques (Intérêts, Espèces, Solde de départ, Virement) ne sont pas proposées à la saisie. L'historique permet de filtrer les transactions sans catégorie (simple valeur de filtre, pas de fonctionnalité dédiée). Stats : « Sans catégorie » regroupé en une ligne.
- Fichiers : `prisma/{schema.prisma,migrations/*,seed.ts}`, `src/{transactions,recurrences,categories,stats,gdpr,scenarios}/*`, `features/{transactions,history,recurrences,stats}/*`, tests.
- Vérif : e2e — création sans catégorie 201 ; sous-catégorie qui n'appartient pas à la catégorie choisie ⇒ 422 ; filtre « sans catégorie » ; stats avec ligne « Sans catégorie » aux totaux exacts ; migration appliquée sur une base contenant des données ; test front : la liste des sous-catégories dépend de la catégorie choisie, les deux champs restent facultatifs. Les anciennes catégories système déjà utilisées sont migrées sans perte (réaffectation vers le nouveau jeu).

**E32 — Page 404 et bouton de retour**
- Objectif : le libellé du bouton dépend de la session (« Retour au tableau de bord » si connecté ; sinon libellé et cible cohérents avec la redirection réelle, ex. « Se connecter »).
- Fichiers : page 404 de `apps/web/src/app`, test composant.
- Vérif : test — session ouverte ⇒ libellé « tableau de bord » ; non connecté ⇒ libellé qui annonce la page réellement atteinte.

**E33 — Simulation de trésorerie : moteur et API**
- Objectif : « combien me restera-t-il au jour X ». Entrées : compte(s), date de début (aujourd'hui par défaut, modifiable), date de fin, **liste des récurrences existantes cochables/décochables**, récurrences supplémentaires **propres à la simulation**, **dépenses/revenus ponctuels anticipés** propres à la simulation. Sortie : solde projeté et **détail des dépenses sur la période** (par récurrence, ponctuelles). Fonctions pures dans `simulations/engine/` ; rien n'est écrit dans les vraies données. Réutilise le moteur de projection (E26) et le moteur de récurrence (E19). **À trancher en début d'étape** : la simulation remplace-t-elle les scénarios « et si » (E27) ou coexiste-t-elle ? Par défaut elle s'appuie sur la même base et E27 n'est supprimé qu'une fois l'UI migrée.
- Fichiers : `src/simulations/engine/cashflow.ts`, `simulations.service.ts`/controller (+ registre d'isolation), specs.
- Vérif : tests purs — solde au jour X avec/sans une récurrence décochée ; ponctuelle anticipée comptée uniquement dans la simulation ; date de début dans le futur ; fin < début ⇒ 400 ; nombre de lignes des tables inchangé après exécution ; isolation entre utilisateurs.

**E34 — Plafond minimum et enveloppe dépensable**
- Objectif : à partir de la simulation, l'utilisateur fixe un **solde plancher** (ex. 200 €). L'API calcule le montant dépensable par mois ou par semaine sans passer sous ce plancher : `(solde projeté en fin de période − plancher) / nombre de périodes`. **Suivi dans le temps** : les dépenses ponctuelles réellement saisies pendant la période sont déduites de l'enveloppe en cours (« il me reste 50 € ce mois-ci ») ; à la fin d'une période, le reliquat est **réparti sur les périodes restantes** (100 €/mois, 50 € dépensés le 1ᵉʳ mois ⇒ 125 €/mois pour les 2 suivants, par recalcul à chaque période). Une simulation doit donc pouvoir être **sauvegardée** (paramètres JSON validés par DTO, version, isolation) puis relue avec les dépenses réelles.
- Fichiers : `src/simulations/engine/allowance.ts`, persistance (`src/scenarios/*` ou nouveau module), specs, e2e.
- Vérif : tests purs — exemple ci-dessus (500 € dans 3 mois, plancher 200 € ⇒ 100 €/mois ; 50 € dépensés ⇒ 50 € restants, puis 125 €/mois) ; plancher supérieur au solde projeté ⇒ enveloppe 0 et alerte ; mois vs semaine ; période en cours partielle ; e2e — simulation sauvegardée relue avec les vraies dépenses ; simulation de B inaccessible à A.

**E35 — Simulation : interface**
- Objectif : écran de simulation (dates, récurrences à décocher, ajout de récurrences/ponctuelles virtuelles, plafond, résultats : solde au jour X, courbe, détail des dépenses, enveloppe restante), sauvegarde/réouverture et suivi mensuel.
- Fichiers : `apps/web/src/app/features/simulations/*`, tests de composants.
- Vérif : tests de composants (décocher une récurrence recalcule ; `12,34` envoie `1234` ; formulaires accessibles) ; `ng test` et `ng build` verts.

### Phase 9 — Administration et communication (SPEC §13)

> Une étape = une session = un commit. Ordre : E36 → E37 → E38 → E39 → E40 → E41. E36 suppose E31 (catégories facultatives à deux niveaux) ; E38, E39 et E40 supposent le rôle admin d'E37 ; E41 suppose E36, E38 et E40. Principes communs : toute route `/admin/*` est ajoutée au registre d'isolation avec une règle « 401 anonyme, 403 non-admin » (le test méta E7 est étendu en conséquence) ; l'administrateur ne voit jamais de transaction d'un utilisateur ; le texte saisi par les utilisateurs est affiché en texte brut ; chaque nouvelle table portant des données personnelles est ajoutée à l'export et à la suppression de compte (E28) et à la politique de confidentialité (`docs/privacy/*`, pages légales).

**E36 — Catégories personnalisables par l'utilisateur**
- Objectif : page « Mes catégories » : liste des catégories globales et personnelles, création de catégories et de sous-catégories (y compris sous une catégorie globale), renommage et masquage **pour soi seul** des catégories globales, suppression des siennes avec réaffectation. Table `UserCategoryPreference(userId, categoryId, hidden, customName?)` (migration versionnée) ; les listes de saisie (E31) excluent les catégories masquées ; l'historique et les stats continuent d'afficher le nom d'une catégorie masquée.
- Fichiers : `prisma/*`, `src/categories/*`, `src/gdpr/*` (export/suppression), `features/categories/*` (page + route), liste de saisie, tests.
- Vérif : e2e — A masque une catégorie : toujours visible pour B, toujours sur les transactions existantes de A ; A renomme une catégorie globale : B voit le nom d'origine ; sous-catégorie perso sous une catégorie globale ; 3ᵉ niveau refusé ; catégorie de B inutilisable par A ; l'export contient les préférences ; tests de composants (masquage, création).

**E37 — Rôle administrateur et page d'administration (statistiques)**
- Objectif : `User.role` (`USER`/`ADMIN`, migration), script d'exploitation `npm run admin:grant -w api -- <email>` (pas d'élévation via HTTP), garde `AdminGuard` (401/403), journal `AdminAuditLog` ; endpoints `GET /admin/stats` (agrégats de SPEC §13.2 : utilisateurs, volumes, stockage, taille de la base via `pg_database_size`, latence de la base, uptime/mémoire du processus, erreurs depuis le démarrage, dernière exécution des tâches planifiées) ; page `/admin` visible seulement pour un admin (lien dans la navigation conditionné à `role`). Pas d'accès aux transactions des utilisateurs.
- Fichiers : `prisma/*`, `src/admin/*`, `src/common/admin.guard.ts`, `scripts/grant-admin.ts`, `test/helpers/isolation-registry.ts`, `features/admin/*`, tests.
- Vérif : e2e — `/admin/stats` : 401 sans session, 403 pour un utilisateur, 200 pour un admin ; aucun champ de la réponse ne contient d'e-mail ni de montant ; `PATCH /me` ne peut pas changer `role` (champ refusé) ; le script refuse un e-mail inconnu ou non vérifié ; actions journalisées sans donnée financière ; test méta étendu (route `/admin/*` sans règle admin ⇒ échec) ; test front : lien admin absent pour un utilisateur ordinaire. **À trancher** : compteurs d'erreurs en mémoire (défaut) ou table.

**E38 — Administration : catégories globales**
- Objectif : l'admin crée, renomme et archive des catégories et sous-catégories globales sans redéploiement (ex. « Aide sociale ») ; elles apparaissent chez tous les utilisateurs (servies par l'API, plus de liste en dur côté front). Libellés des catégories du seed (clés de traduction) conservés ; les créées par l'admin portent un nom libre. Archivage au lieu de suppression si utilisée ; colonne `archivedAt` (migration).
- Fichiers : `src/admin/categories.*`, `src/categories/*`, `features/admin/categories/*`, tests.
- Vérif : e2e — création par l'admin : visible pour A et B dans leurs listes ; archivage : disparaît des listes de saisie mais reste sur les transactions existantes ; utilisateur non admin ⇒ 403 ; deux niveaux max ; doublon de nom refusé ; actions dans le journal.

**E39 — Retours utilisateurs (formulaire libre) et boîte de réception admin**
- Objectif : page « Donner mon avis » (type avis/idée/problème, texte borné) ; limites par utilisateur : 5 retours par 24 h et 20 non traités au plus ; table `Feedback(userId, type, message, status, createdAt, treatedAt)` ; boîte de réception dans l'admin **triable/filtrable par type et par statut** (liste, détail, passage à « traité ») ; contenu en texte brut ; tâche planifiée de purge : suppression 30 jours après `treatedAt`, ou 90 jours après `createdAt` si jamais traité (constantes), avec avertissement dans l'admin pour les retours proches de l'échéance.
- Fichiers : `prisma/*`, `src/feedback/*`, `src/admin/feedback.*`, `features/feedback/*`, `features/admin/feedback/*`, `src/gdpr/*`, pages légales, tests.
- Vérif : e2e — un utilisateur ne voit que ses propres retours ; la 6ᵉ soumission en 24 h ⇒ 429 et la 21ᵉ non traitée ⇒ refus ; message trop long ou vide ⇒ 400 ; filtre admin par type et par statut ; purge avec horloge injectée (traité il y a 29 j conservé, 31 j supprimé ; non traité 89 j conservé, 91 j supprimé) ; admin liste et traite ; non admin ⇒ 403 sur l'inbox ; message contenant du HTML affiché comme texte ; inclus dans l'export et supprimé avec le compte.

**E40 — Notifications (cloche) et annonces**
- Objectif : tables `Announcement` (diffusion à tous, un seul enregistrement) et `Notification` (ciblée, `readAt`), avec l'état « lu » des annonces par utilisateur ; API `GET /notifications` (annonces postérieures à l'inscription + notifications personnelles, non lues d'abord), compteur, marquage lu ; cloche avec pastille dans la barre de navigation ; côté admin, envoi d'une annonce à tous et d'une notification à un utilisateur précis. Une annonce ne remplace pas l'e-mail RGPD (rappelé dans l'écran d'envoi) ; pour une modification des CGU, l'écran propose un préavis de 30 jours par défaut et aucune ré-acceptation explicite n'est imposée (SPEC §13.6).
- Fichiers : `prisma/*`, `src/notifications/*`, `src/admin/notifications.*`, `features/notifications/*` (cloche), `features/admin/notifications/*`, `src/gdpr/*`, tests.
- Vérif : e2e — annonce créée par l'admin : visible pour tous, lue indépendamment par chaque utilisateur ; notification ciblée visible uniquement du destinataire (404 pour les autres) ; compteur exact avant/après lecture ; un utilisateur ne peut pas créer d'annonce (403) ; un nouvel inscrit ne reçoit pas les annonces antérieures à son inscription ; test de composant : pastille avec le bon nombre, texte brut.

**E41 — Suggestion de catégorie et réponse à l'auteur**
- Objectif : dans le formulaire de création d'une catégorie perso (E36), case facultative « proposer cette catégorie à tous » ⇒ `CategorySuggestion(userId, name, parentId?, status)` visible dans l'admin ; l'admin accepte (crée la catégorie globale via E38), refuse ou traite, et peut répondre à l'auteur par une notification personnelle (E40), avec un message prérempli modifiable (« J'ai vu ta suggestion de la catégorie X, je l'ai ajoutée, merci ! »).
- Fichiers : `src/categories/*`, `src/admin/suggestions.*`, `features/categories/*`, `features/admin/suggestions/*`, `src/gdpr/*`, tests.
- Vérif : e2e — case cochée ⇒ suggestion créée, case décochée ⇒ aucune ; l'admin accepte : la catégorie globale existe chez tous et l'auteur reçoit une notification ; refus ⇒ aucune catégorie globale ; suggestion déjà traitée non rejouable ; un utilisateur ne voit que ses propres suggestions ; export et suppression de compte couvrent la table.

### Phase 10 — Finalisation fonctionnelle

> E42 (tableau de bord) est décrite dans SPEC §7 et se fait en trois sous-étapes, une à la fois (E42a → E42b → E42c). E43 se fait en dernier, une fois toutes les fonctionnalités présentes.

**E41b — Coffre-fort (`/me/coffre`)** ✅ (2026-10-19)
- Objectif : liste de tous les documents (pièces de transactions + dépôts directs), tri / filtres / recherche côté client, tags (réutilise `Tag`), aperçu, téléchargement, suppression, espace utilisé (SPEC §4).
- Migration `20261019084908_vault` (additive) : `Attachment.transactionId` facultatif, table `AttachmentTag`.
- API `/v1/documents` : `GET` (liste, corbeille exclue), `POST` (dépôt direct, mêmes contrôles qu'une pièce), `GET :id/url[?download=1]` (URL signée 5 min ; `download=1` ⇒ `Content-Disposition: attachment; filename*=UTF-8''…`), `PUT :id/tags`, `DELETE :id`. Les cinq routes sont au registre d'isolation. RGPD : `AttachmentTag` exporté ; la réinitialisation supprime aussi les dépôts directs.
- Front : `features/my-account/vault-page.ts` (route lazy), carte « Coffre-fort » dans `/me`, l'historique lit `?from&to&accountId` (lien « transaction liée »).
- Vérif : `test/e2e/documents.e2e-spec.ts` (liste, corbeille, dépôt 415/400/422, URL et nom téléchargé encodé, tags remplacés / dédoublonnés / tag supprimé, suppression base + S3), isolation, `gdpr.e2e-spec.ts` (export, reset, suppression) ; `vault-page.spec.ts`, `history-page.spec.ts` (lien entrant).
- Non fait : rattacher un dépôt direct à une transaction, pagination de la liste (supportable jusqu'à quelques milliers de documents), vignettes.

**E41c — Champ tags en puces (remarque R-2)** ✅ (2026-11-03)
- Constat vérifié : l'API accepte déjà `tagIds` à la création (`transactions.dto.ts`) et `POST /tags` existe, mais `transaction-form-page.ts` n'a aucun champ tags (seul le filtre de l'historique les utilise). Étape purement front, sans migration ni nouvel endpoint.
- Objectif : composant partagé de saisie de tags : texte libre, Entrée crée une puce (réutilise le tag existant de même nom, sinon `POST /tags`), croix pour la retirer, plusieurs tags, suggestions des tags existants, accessible au clavier (`aria-label` sur la croix, annonce de l'ajout/retrait). Intégré à « Nouvelle transaction » (bloc `details.more`, à côté des notes, aussi en modale).
- Fichiers : `apps/web/src/app/shared-ui/tag-input.ts` (+ spec), `features/transactions/transaction-form-page.ts`.
- Vérif : `tag-input.spec.ts` (Entrée crée, doublon ignoré sans tenir compte de la casse, croix retire, champ vide ignoré) ; `transaction-form-page.spec.ts` (le POST envoie `tagIds`) ; parcours manuel mobile et bureau ; `ng test`, `ng build` verts.

**E41d — Modification complète d'une transaction (remarque R-1)** ✅ (2026-11-03)
- Constat vérifié : `PATCH /transactions/:id` accepte déjà `categoryId`, `subcategoryId`, `details`, `tagIds`, `accountId`, `type` ; seul le formulaire d'édition de `history-page.ts` était limité à montant, libellé et date. Les jambes de virement étaient refusées par `PATCH /transactions/:id` (422) et `PATCH /transfers/:id` n'acceptait ni catégorie ni tags.
- Décisions du propriétaire : compte et sens (dépense/revenu) modifiables pour une transaction ordinaire ; catégorie et tags aussi modifiables sur un virement (comptes et sens d'un virement inchangés).
- Objectif : le formulaire d'édition de l'historique propose, préremplis, le sens, le compte, catégorie puis sous-catégorie, notes et tags (composants `category-fields` et `tag-input`, partagés avec la saisie). Seuls les champs changés partent (catégorie, notes, tags, compte, sens) : une catégorie technique, masquée ou archivée n'est jamais écrasée ; effacer la catégorie envoie `categoryId: null`. Virement : « Modifier » lit `GET /transfers/:id` (le verrou est la version du virement, pas celle d'une jambe), masque sens et compte, puis `PATCH /transfers/:id` applique tout aux deux jambes. `UpdateTransferInput` gagne `categoryId`, `subcategoryId`, `tagIds` (`categoryId: null` rétablit la catégorie système « Virement »). Version périmée (409) : proposer de recharger ; 422 : message portefeuille non suivi.
- Fichiers : `features/history/history-page.ts`, `shared-ui/category-fields.ts` (extrait de `transaction-form-page.ts`), `packages/shared/src/dto/transfer.ts`, `apps/api/src/transfers/*` (aucune migration, aucun nouvel endpoint) (+ specs).
- Vérif : `history-page.spec.ts` (PATCH avec catégorie, sous-catégorie, notes, tags ; catégorie effacée ⇒ `null` ; catégorie technique non envoyée ; compte et sens ; 409 et 422 ; virement : GET puis PATCH `/transfers` avec sa version) ; `transfers.e2e-spec.ts` (catégorie, sous-catégorie et tags sur les deux jambes, `null` ⇒ « Virement », 422 sous-catégorie orpheline, 404 tag inconnu) ; registre d'isolation (catégorie et tag d'un autre utilisateur ⇒ 404) ; `npm test` racine, `shared`, `api`, `web`, lint et build verts ; contrôle manuel mobile et bureau.

**E42 — Tableau de bord (route `/`, SPEC §7)** ✅ (2026-11-03) : trois sous-étapes, une à la fois.
- Réutilise les endpoints existants : `/accounts/:id/balance`, `/accounts/:id/interest-rates`, `/stats/by-category` (totaux de la période, virements exclus), `/transactions?limit=5`, `/notifications`, `/cashflow-simulations/:id/result` (`belowFloor`) et `QuickEntry`. Seuls nouveaux : la série de soldes, les échéances à venir et les préférences (E42a).
- Période unique (mois actuel par défaut, 3 mois, 6 mois, 12 mois ; changé après E42c à la demande du propriétaire, les anciennes valeurs enregistrées repassent à « mois actuel ») : elle pilote dépenses/revenus, donut et fenêtre de la courbe. L'enveloppe de simulation n'est pas au tableau de bord (seul son plancher intervient dans l'alerte).
- Cochée (✅ avec la date) seulement après le retour du propriétaire sur les contrôles manuels (360 px et 1280 px).

**E42a — API : préférences, série de soldes, échéances** ✅ (2026-11-03) (dépend d'E30)
- Objectif : trois endpoints, aucun écran.
  - `GET` et `PUT /v1/dashboard/preferences` : JSON validé par DTO (période, `accountIds` — null = tous —, `curveAccountIds`, `curveTotal`, `hiddenBlocks`), limité à 50 identifiants, verrouillé par version.
  - `GET /v1/dashboard/balance-series?from&to&accountIds` : solde de chaque jour pour chaque compte, plus le total, avec le calcul de `balanceSql` (solde de départ, transactions antérieures exclues, `countInBalance`, virements pris en compte). Fonction pure dans `dashboard/engine/balance-series.ts`.
  - `GET /v1/dashboard/upcoming?days=7` : occurrences de `occurrencesBetween` sur ]aujourd'hui, +7 jours].
- Fichiers : `prisma/schema.prisma` et migration versionnée (table `DashboardPreference`), `src/dashboard/*`, `packages/shared/src/dto/dashboard.ts`, `src/gdpr/*` (export, suppression de compte, réinitialisation), registre d'isolation, specs et e2e.
- Vérif : tests purs — transaction antérieure au solde de départ (courbe inchangée), jour du solde de départ avec les deux valeurs de `countInBalance`, virement entre deux comptes (total plat), compte `NOT_TRACKED` exclu, fenêtre d'un jour ; e2e — le dernier point de la série égale `currentCents` de `/balance`, préférences d'un utilisateur invisibles à un autre, `accountId` étranger ⇒ 404, JSON invalide ⇒ 400, version périmée ⇒ 409, préférences exportées et supprimées avec le compte, conservées par la réinitialisation ; `EXPLAIN` utilise l'index `(accountId, date)` ; lint, build, `npm test` racine, `shared`, `api`, `web` verts.

**E42b — Page : socle, chiffres clés, alertes, personnalisation** ✅ (2026-11-03) (dépend d'E42a)
- Objectif : la route `/` charge la page à la place du placeholder. Actions rapides (« + Transaction », « Virement »), checklist d'état vide en 3 étapes, carte « Solde total » et comptes choisis, sélecteur de période, dépenses/revenus/reste avec comparaison à la période précédente, quatre alertes (taux manquant, prévisionnel négatif ou sous le plancher, récurrences des 7 jours, notifications non lues), panneau « Personnaliser » (case par compte et par bloc, enregistré par `PUT`).
- Fichiers : `features/dashboard/*`, `app.routes.ts` ; styles partagés dans `styles.scss` (budget de 4 ko par composant).
- Vérif : tests de composant — état vide ⇒ checklist, étapes faites cochées ; total sans compte `NOT_TRACKED` ; compte masqué ⇒ disparaît et `PUT` envoyé ; alertes présentes ou non selon les données ; montants formatés depuis les centimes, aucun `Date` ; `ng test` et `ng build` verts. À contrôler à la main : 360 px sans défilement horizontal, 1280 px sur deux colonnes, focus et contrastes AA.

- Choix validés en E42a/E42b : blocs masquables `KEY_FIGURES`, `PERIOD_SUMMARY`, `BALANCE_CURVE`, `LATEST_TRANSACTIONS`, `CATEGORY_DONUT` (le panneau « Personnaliser » n'affiche que ceux déjà présents) ; premier `PUT` des préférences en `version: 0` ; série limitée à 400 jours (422 au-delà) ; périodes en mois entiers ; « Solde total » et alerte de prévisionnel négatif sur tous les comptes suivis ; première transaction détectée par `/stats/monthly`.
- Modifié après E42c à la demande du propriétaire : la série de soldes ne laisse plus à plat l'historique d'avant le solde de départ, elle le reconstitue à rebours (la Vérif d'E42a « transaction antérieure au solde de départ ⇒ courbe inchangée » ne vaut plus que pour le solde actuel et les jours depuis le solde de départ).
- Écart connu, hors E42 : le solde de départ ne se saisit qu'à la création du compte ; l'étape 2 de la checklist renvoie vers `/accounts`, sans moyen d'en ajouter un à un compte existant.

**E42c — Page : courbe, dernières transactions, donut** ✅ (2026-11-03) (dépend d'E42b)
- Objectif : composant `balance-chart` en SVG sur le modèle de `projection-chart` : un ou plusieurs comptes, total plus épais, légende et trait distincts sans dépendre de la couleur seule, alternative textuelle. Plus les 5 dernières transactions et le donut (`app-donut-chart` réutilisé), tous deux masquables.
- Vérif : tests de composant — total plus épais que les comptes, décocher un compte retire sa courbe, `PUT` des préférences correct, alternative textuelle présente ; lint, build et les quatre suites vertes ; contrôle manuel de la lisibilité à 360 px.

**E43 — Refonte du style (dernière étape fonctionnelle)** ✅ (2026-11-06)
- Objectif : à faire **une fois toutes les fonctionnalités présentes** : couleurs, polices, dispositions, images, actions (modales pour certains formulaires, menus déroulants…). Une charte (tokens couleurs, typographie, composants) est fixée d'abord, puis appliquée écran par écran ; accessibilité AA conservée (`apps/web/.claude/CLAUDE.md`).
- Fichiers : `apps/web/src/styles.scss`, `shared-ui/*`, templates des `features/*`.
- Remarques d'usage rattachées (`docs/remarques.md`), à traiter dans cette étape :
  - **R-3 — Statistiques qui débordent à droite sur mobile (/stats, 360 px).** ✅ (2026-11-03) Cause probable vérifiée : `.stats-section table { min-width: 22rem }` dans `stats-page.ts` (352 px + marges > 360 px). Corriger (tableau scrollable dans un conteneur `overflow-x: auto` ou colonnes réduites) et contrôler donut et histogramme.
  - **R-4 — Barre du haut trop chargée sur mobile.** ✅ (2026-11-03) Aujourd'hui `app.html` y place menu, marque, cloche, « + Transaction » et avatar. Sur mobile seulement : cloche et « Mon compte » (avec Donner mon avis, thème, déconnexion) passent dans le menu déroulant de navigation ; la pastille rouge de notification s'affiche aussi sur le bouton du menu. Bureau inchangé.
  - **R-5 — Indice de dépliage sur « Solde jour par jour » (/simulations).** ✅ (2026-11-03) Le `<summary>` de `cashflow-page.ts` est en `display: flex` : le marqueur natif disparaît. Ajouter un chevron (haut/bas selon `open`), purement CSS, sans changer la logique ; vérifier si d'autres `<details>` (filtres de l'historique) ont le même défaut.
  - Vérif de ces trois points : parcours à 360 px sans défilement horizontal (/stats), pastille visible sur le bouton du menu mobile, chevron qui change d'état au clavier et à la souris.
- Vérif : `ng test` et `ng build` verts, parcours manuel complet mobile et bureau, contrastes vérifiés ; aucune logique métier modifiée (diff limité aux templates/styles).

**E43b — Corrections de l'audit navigateur d'E43 (2026-11-06)** ✅ (2026-11-06)
- Contexte : audit réel (Chromium, 375/768/1280 px, clair/sombre, axe-core) : lint, build et tests verts, aucun scroll horizontal de page, aucun défaut de contraste. E43 reste ouverte tant que les points ci-dessous ne sont pas corrigés ; ne cocher E43 qu'à la fin d'E43b. Seuls templates et styles sont touchés, aucune logique métier.
- **D1 (important) — /stats, régions défilantes non focusables** (axe `scrollable-region-focusable`, mobile et tablette). Dans `features/stats/stats-page.ts`, les conteneurs `.scroll` des sections `h-monthly` et `h-category` reçoivent `tabindex="0"`, `role="region"` et un `aria-labelledby` vers leur titre ; ajouter un indice visuel de défilement (ombre de bord ou colonnes réduites) pour que « Dépenses » du tableau « Par catégorie » ne soit plus coupé sans signal (complète R-3).
- **D2 (important) — Dashboard, courbe du solde** (`features/dashboard/balance-chart.ts`) : sur mobile, les libellés d'axes sont écrasés par la mise à l'échelle du SVG (taille de police en unités du viewBox) ; sur bureau, le libellé « 9 420,00 € » chevauche le début de la courbe (marge gauche). Conserver `role="img"`, l'`aria-label` et la navigation clavier existants.
- **D3 (mineur) — /simulations, étape « Période », 375 px** (`features/simulations/cashflow-page.ts`) : l'input « Date de fin » dépasse du bord droit de sa carte (grille à deux colonnes avec `min-width: 0` sur les champs, ou passage en une colonne sur mobile).
- **D4 (mineur) — cibles tactiles** : liens autonomes de 19 à 21 px de haut (« Mot de passe oublié ? », « Tout l'historique », « Voir les statistiques », « ← Administration », liens du pied de page, liens de l'accueil admin). Ajouter un `min-height`/padding global dans `styles.scss` pour atteindre 24 px sans changer la mise en page des liens dans le texte courant.
- **R-5 à confirmer** : le chevron global existe (`styles.scss` ~l. 1129, visible sur « Filtres ») mais « Solde jour par jour » (`details.daily`, `cashflow-page.ts`) n'a pas été contrôlé : calculer une simulation (comptes, date de fin, ligne de mouvement), vérifier que le chevron change d'état à la souris et à Entrée/Espace.
- **R-4 à confirmer** : pastille rouge sur le bouton du menu mobile à vérifier avec une notification non lue (en créer une depuis `/admin/notifications`).
- Contrôles complémentaires restés partiels à l'audit : navigation clavier et modales sur toutes les pages (Tab/Maj+Tab, Échap, pas de piège de focus), états vide/erreur/chargement des formulaires, modale d'édition de l'historique.
- Vérif : `npm run lint`, `npm run build`, `npm test`, `npm test -w @budgetracker/shared`, `npm test -w api`, `npm test -w web` verts (sans exécuter le build de `shared` en parallèle : deux échecs transitoires « no tests » vus à la 1re exécution, verts à la 2e) ; nouvel audit axe sur /stats à 375 et 768 px sans violation ; aucun scroll horizontal ; D2 lisible à 375 px ; D3 sans débordement ; D4 sans cible < 24 px hors texte courant ; R-4 et R-5 confirmés au navigateur ; puis cocher E43.
- Fait : D1 (`.scroll` focusable, `role="region"` nommé par la légende du tableau, car la section porte déjà le nom du titre ; ombre de bord en CSS sur tous les `.scroll`) ; D2 (libellés d'axes sortis du SVG en HTML, montants dans une gouttière à gauche) ; D3 (`min-width: 0` sur les champs) ; D4 (`padding-block` sur les liens autonomes, neutre pour la hauteur de ligne) ; historique : « Chargement… » et `aria-busy` pendant le chargement de la liste. Audit : axe /stats sans violation à 375/768/1280, clair et sombre ; aucun scroll horizontal ; aucune cible < 24 px hors texte ; R-4 (pastille clair/sombre) et R-5 (souris, Entrée, Espace) confirmés ; 9 modales : focus initial dedans, Tab ne sort pas, Échap ferme, focus rendu au déclencheur.
- Écarts restants, hors E43b (ils demandent du TypeScript, pas seulement templates/styles) : dans l'historique, ouvrir ou annuler l'édition en ligne laisse le focus sur `body` (le bouton « Modifier » disparaît du DOM) ; `projection-chart` (simulations) garde des libellés d'axes en unités du viewBox, donc le même écrasement que D2 sur mobile.

**E43c — Administration : liste des utilisateurs, offre premium et quota (SPEC §13.7)** (dépend d'E43b)
- Objectif : page `/admin/users` (tableau, recherche, filtres, tri, pagination côté serveur, critères dans l'URL) et actions d'administration sur l'offre et le quota, sans aucune donnée financière.
- Données : migration `User.plan` (enum `Plan` : `FREE`, `PREMIUM`, défaut `FREE`) et `User.version` (verrou des actions admin). Constantes de quota par offre (200 Mo, 2 Go) et bornes du quota personnalisé (10 Mo à 50 Go) dans `packages/shared`.
- API : `GET /api/v1/admin/users?q&role&plan&verified&activity&storageOver80&sort&dir&page` (50 par page ; renvoie `items`, `total`). Stockage utilisé calculé par agrégat SQL sur `Attachment.sizeBytes` (pièces à la corbeille comprises), sans requête N+1. `PATCH /api/v1/admin/users/:id` (`plan` ou `storageQuotaBytes`, avec `version`) : 409 si la version est périmée, 422 hors bornes, quota remis à la valeur de l'offre quand l'offre change, entrée `AdminAuditLog` (identifiant visé, ancienne et nouvelle valeur, sans e-mail). Toutes les routes : `JwtAuthGuard` + `AdminGuard`, et ajout à `adminRoutes` du registre d'isolation. Le DTO ne contient que les champs de §13.7 : aucun champ de compte ni de transaction.
- Front : `features/admin/users/` avec un lien depuis l'accueil admin. Tableau dans un conteneur `.scroll` focusable (motif d'E43b) ; tri par en-têtes boutons avec `aria-sort` ; recherche différée (debounce) ; état vide, erreur et chargement ; modale d'action (offre ou quota) avec le message 409 « rechargez ». Page Confidentialité complétée (§13.7).
- Vérif : tests API (401 anonyme, 403 non-admin, recherche insensible à la casse et aux accents, chaque filtre, chaque tri, pagination et `total`, stockage corbeille comprise, 409, 422, journal écrit sans e-mail, aucun champ financier dans la réponse) ; registre d'isolation à jour ; tests de composant (critères ↔ URL, `aria-sort`, modale) ; `npm run lint`, `npm run build` et les quatre suites vertes ; axe sans violation et aucun défilement horizontal sur `/admin/users` à 375, 768 et 1280 px, en clair et en sombre.

### Phase 11 — Déploiement, sauvegardes, supervision (SPEC §11.7)

> Le passage du local au serveur OVH commence ici. Ordre : E44 → E45 → E46.

**E44 — Conteneurs et déploiement**
- Objectif : Dockerfiles (api, web), `docker-compose.yml` de prod, Caddy (TLS Let's Encrypt, HSTS, CSP), BDD non publiée, secrets par variables d'environnement, migrations au déploiement ; ajout du build d'images à la CI.
- Fichiers : `apps/*/Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile`, `ci.yml`.
- Vérif : `docker compose up -d --build` en local ⇒ `curl -I https://localhost/` renvoie les en-têtes CSP/HSTS ; `docker compose ps` montre que le port 5432 n'est pas publié ; `git ls-files | xargs grep -l "PASSWORD="` ne remonte aucun secret réel.

**E45 — Sauvegardes**
- Objectif : `pg_dump` quotidien chiffré (age/gpg) vers OVH Object Storage, rétention 30 jours (règle de cycle de vie), script de restauration, **restauration testée**.
- Fichiers : `deploy/backup/{backup.sh,restore.sh}`, `docs/runbook-backup.md`, cron/job.
- Vérif : restaurer le dernier dump dans une base vierge et comparer les comptages par table avec la source ; sans la clé, le dump est illisible ; l'objet de plus de 30 jours est supprimé.

**E46 — Supervision et check-list de lancement**
- Objectif : sonde de disponibilité externe, alerte disque/erreurs, test automatisé de non-fuite dans les logs, `npm audit`, revue OWASP ciblée (auth, upload, isolation).
- Fichiers : `docs/launch-checklist.md`, config de sonde.
- Prérequis : toutes les étapes E30 à E43 terminées (E42 seulement si le tableau de bord a été décrit). Vérif : check-list entièrement cochée (E45 restauration testée, E29 pages en ligne, E29b/E29c consentement CGU serveur,  aucune vulnérabilité haute non traitée, test de log vert).

## 5. Hypothèses (à contredire si fausses)

1. **Une table `Transfer`** porte version et suppression logique des deux jambes ; `Transaction.type` reste `DEBIT|CREDIT` (le « TRANSFER » de la SPEC = `transferId` non nul). Le retrait vers `NOT_TRACKED` n'a **pas** de `transferId` : c'est une dépense ordinaire en catégorie « Espèces ».
2. **Le serveur ne matérialise les récurrences que jusqu'à aujourd'hui** (job + rattrapage). Les occurrences futures n'apparaissent que dans la projection ; le « solde prévisionnel » de §3.3 ne contient que les transactions futures saisies à la main.
3. **Livret A simplifié** : quinzaines 1–15 et 16–fin de mois ; solde de la quinzaine = minimum des soldes de fin de journée ; intérêt = `solde_min × taux / 24`, arrondi au centime par quinzaine, **sans capitalisation intra-année** (les intérêts de l'année ne portent pas intérêt avant d'être crédités le 31/12). Taux applicable = dernier `effectiveDate` ≤ début de quinzaine.
4. Taux stocké en **points de base** (entier) ; suffisant pour des taux à 0,01 %.
5. Montants max supportés en `number` JS (≤ 9·10¹⁵ centimes) ; `BIGINT` en base pour respecter la SPEC.
6. Tests API sous **Jest** (défaut Nest) et front sous **Vitest** (défaut Angular 21) : deux lanceurs, mais aucune configuration exotique.
7. Validation par `class-validator` côté API ; `shared` ne contient que types/enums/helpers, pas de schémas de validation.
8. Cookies uniquement techniques ⇒ **pas de bandeau de consentement** cookies.
9. L'utilisateur de dev installe Docker Desktop (nécessaire de toute façon pour Compose en prod).
10. La rétention des sauvegardes est de 30 jours et la fenêtre du rythme moyen de 3 mois (valeurs par défaut de la SPEC §12).
11. Un compte supprimé logiquement masque ses transactions ; un compte restauré les rend à nouveau visibles.
12. Le front est reconstruit de zéro selon `apps/web/.claude/CLAUDE.md` (standalone, OnPush, signals, formulaires réactifs) ; l'ancien code applicatif est supprimé sans reprise. Aucune charte graphique n'est imposée : design sobre mobile-first, à affiner à partir des wireframes.

## 6. Risques

| # | Risque | Impact | Parade |
|---|---|---|---|
| R1 | Packaging de `shared` entre Nest (CommonJS, `tsc`) et Angular (ESM, esbuild) | Build cassé, enums dupliqués | Points de contrôle explicites en **E1** (Nest) et **E14** (Angular) ; repli : sortie `tsc` double ESM/CJS |
| R2 | Docker absent, Postgres local requis pour tous les tests d'intégration | Étapes E3+ bloquées | Prérequis E0 ; la CI utilise un service Postgres |
| R3 | Une occurrence supprimée puis **purgée** (30 j) est régénérée par le rattrapage | Données fantômes | Génération seulement pour les dates > `lastGeneration` ; test dédié en E20 |
| R4 | Concurrence de génération (job + connexion + 2 onglets) | Doublons | Contrainte unique non partielle + `ON CONFLICT DO NOTHING` + verrou consultatif ; test à 20 appels |
| R5 | Fuite inter-utilisateurs par référence croisée (`categoryId`, `accountId`, `tagId` d'un autre) | Faille majeure | Vérification de propriété dans chaque service + harnais E7 + tests par route |
| R6 | `BigInt` Prisma non sérialisable en JSON, `Date @db.Date` décalée par fuseau | Erreurs 500, jour décalé | Mapper unique (principe d'architecture n°3), tests de bord (23 h UTC) |
| R7 | Interprétation du Livret A (quinzaines, valeurs, arrondi) | Montants d'intérêts faux | Hypothèse 3 écrite, cas de test calculés à la main, **à valider par l'utilisateur avant E21** |
| R8 | Rotation des refresh tokens avec onglets concurrents | Déconnexions intempestives | Fenêtre de grâce courte sur l'ancien token ; test dédié E5 |
| R9 | Front vide entre E14 et E18 (l'ancien est supprimé) | Rien de démontrable côté UI pendant quelques étapes | E14→E18 en petites tranches, chaque étape garde `ng build` vert ; l'API reste testable seule (e2e, curl) |
| R10 | Stats / solde lents avec beaucoup de transactions | Lenteur | Index (accountId, date) et (userId, date, id) ; `EXPLAIN` en test E11 ; pas de chargement de lignes pour agréger |
| R11 | Upload : fichier malveillant, zip-bomb d'image, quota contourné par requêtes parallèles | Abus, coût | Signature + taille avant envoi S3, quota vérifié en transaction, URL signée courte |
| R12 | L'administrateur peut lire les données (volume chiffré seulement) | Confiance, RGPD | Dit explicitement dans la politique de confidentialité (E29) |
| R13 | Pas de staging : une migration destructive casse la prod | Perte de données | Migrations additives d'abord, test sur copie locale de la prod, sauvegarde avant déploiement |
| R14 | Contenu légal non rédigé par un juriste | Non-conformité | Gabarits + relecture ; bloquant avant ouverture publique (E46) |
| R15 | Volume du chantier (32 étapes) pour un seul développeur | Dérive de périmètre | Chaque phase livre une version utilisable ; phases 6 et 7 peuvent glisser sans bloquer les phases 1–5 |
| R16 | Compte administrateur compromis ou route `/admin` mal protégée | Accès aux agrégats et à l'envoi de messages à tous | Rôle attribué hors HTTP, garde testé (401/403) sur chaque route admin, journal des actions, e-mail vérifié exigé, aucune donnée financière exposée |

## 7. Écarts volontaires avec la SPEC §11

- **CI avancée en E2** (la SPEC la met en fin de parcours) : chaque étape suivante est vérifiée automatiquement ; seul le build d'images Docker reste en E44.
- **Audit du front (SPEC §11.2) remplacé par une reconstruction** (E14) : décision de l'utilisateur, l'existant est trop superficiel pour être réutilisé.
- **Étape E7 (harnais d'isolation) insérée avant les ressources** pour que la règle « test d'isolation sur chaque endpoint » soit appliquée dès la première route plutôt que rattrapée.

## 8. Vérification globale (fin de v1)

1. `npm ci && npm run lint && npm test && npm run build` à la racine : tout vert.
2. `docker compose -f docker-compose.dev.yml up -d` puis `npm run start -w api` et `npm start -w web` : parcours complet inscription → vérification → compte → dépense en 3 champs → virement → récurrence → stats → scénario → export → suppression de compte.
3. Test de la SPEC §10 « deux générations simultanées sans doublon » vert.
4. Restauration de sauvegarde réussie sur base vierge (E45).
