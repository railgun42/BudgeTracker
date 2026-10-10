# PLAN — BudgeTracker v1

> Dérivé de `SPEC.md` (v1 validée) et d'un état des lieux du dépôt (front existant ignoré, reconstruit de zéro). Aucun code n'est écrit à ce stade.
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
| **Attachment** | userId, transactionId (unique ⇒ 0..1), s3Key, originalName (affichage seul), mime, sizeBytes | quota = `SUM(sizeBytes)` par utilisateur |
| **Recurrence** | accountId, interval, unit (`DAY`/`WEEK`/`MONTH`/`YEAR`), startDate, endDate?, anchorDay, lastGeneration?, version, deletedAt | |
| **TransactionTemplate** | recurrenceId (1-1), name, amountCents, type, categoryId, details, tags | lu **au moment de la génération** ⇒ « futur seulement » sans réécrire le passé |
| **InterestRate** | accountId, rateBp (taux annuel en points de base), effectiveDate | unique (accountId, effectiveDate) |
| **InterestCredit** | accountId, year, transactionId | **unique (accountId, year)** ⇒ idempotence du 31/12 |
| **Scenario** | userId, name, params (JSON), version | `params` validé par un DTO union discriminée, pas du JSON libre |

Catégories système seedées : *Intérêts*, *Espèces*, *Solde de départ* + un jeu de catégories de base (reprendre Divertissement/Sport/Courses/Logement du front).

### Surface d'API (préfixe `/api/v1`)
`auth/{signup,verify-email,login,refresh,logout,forgot,reset,google}` · `me` · `accounts` · `categories` · `tags` · `transactions` (+`?cursor&limit=50&from&to&categoryId&tagId&accountId`) · `transfers` · `accounts/:id/balance` · `recurrences` · `accounts/:id/interest-rates` · `transactions/:id/attachment` · `stats/{by-category,by-tag,monthly}` · `simulations/{projection,savings-goal,loan,investment}` · `scenarios` (+`/compare`) · `me/export` · `DELETE me` · `health`.

## 4. Étapes ordonnées

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
- Objectif : lint + tests + build à chaque push, avec service Postgres. Le build d'images Docker est ajouté à E30.
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

**E30 — Conteneurs et déploiement**
- Objectif : Dockerfiles (api, web), `docker-compose.yml` de prod, Caddy (TLS Let's Encrypt, HSTS, CSP), BDD non publiée, secrets par variables d'environnement, migrations au déploiement ; ajout du build d'images à la CI.
- Fichiers : `apps/*/Dockerfile`, `docker-compose.yml`, `deploy/Caddyfile`, `ci.yml`.
- Vérif : `docker compose up -d --build` en local ⇒ `curl -I https://localhost/` renvoie les en-têtes CSP/HSTS ; `docker compose ps` montre que le port 5432 n'est pas publié ; `git ls-files | xargs grep -l "PASSWORD="` ne remonte aucun secret réel.

**E31 — Sauvegardes**
- Objectif : `pg_dump` quotidien chiffré (age/gpg) vers OVH Object Storage, rétention 30 jours (règle de cycle de vie), script de restauration, **restauration testée**.
- Fichiers : `deploy/backup/{backup.sh,restore.sh}`, `docs/runbook-backup.md`, cron/job.
- Vérif : restaurer le dernier dump dans une base vierge et comparer les comptages par table avec la source ; sans la clé, le dump est illisible ; l'objet de plus de 30 jours est supprimé.

**E32 — Supervision et check-list de lancement**
- Objectif : sonde de disponibilité externe, alerte disque/erreurs, test automatisé de non-fuite dans les logs, `npm audit`, revue OWASP ciblée (auth, upload, isolation).
- Fichiers : `docs/launch-checklist.md`, config de sonde.
- Vérif : check-list entièrement cochée (E31 restauration testée, E29 pages en ligne, aucune vulnérabilité haute non traitée, test de log vert).

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
| R14 | Contenu légal non rédigé par un juriste | Non-conformité | Gabarits + relecture ; bloquant avant ouverture publique (E32) |
| R15 | Volume du chantier (32 étapes) pour un seul développeur | Dérive de périmètre | Chaque phase livre une version utilisable ; phases 6 et 7 peuvent glisser sans bloquer les phases 1–5 |

## 7. Écarts volontaires avec la SPEC §11

- **CI avancée en E2** (la SPEC la met en fin de parcours) : chaque étape suivante est vérifiée automatiquement ; seul le build d'images Docker reste en E30.
- **Audit du front (SPEC §11.2) remplacé par une reconstruction** (E14) : décision de l'utilisateur, l'existant est trop superficiel pour être réutilisé.
- **Étape E7 (harnais d'isolation) insérée avant les ressources** pour que la règle « test d'isolation sur chaque endpoint » soit appliquée dès la première route plutôt que rattrapée.

## 8. Vérification globale (fin de v1)

1. `npm ci && npm run lint && npm test && npm run build` à la racine : tout vert.
2. `docker compose -f docker-compose.dev.yml up -d` puis `npm run start -w api` et `npm start -w web` : parcours complet inscription → vérification → compte → dépense en 3 champs → virement → récurrence → stats → scénario → export → suppression de compte.
3. Test de la SPEC §10 « deux générations simultanées sans doublon » vert.
4. Restauration de sauvegarde réussie sur base vierge (E31).
