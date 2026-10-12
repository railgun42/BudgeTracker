# Graph Report - BudgeTracker  (2026-10-12)

## Corpus Check
- 132 files · ~45,117 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1039 nodes · 2394 edges · 58 communities (43 shown, 15 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.85)
- Token cost: 121,535 input · 0 output

## Community Hubs (Navigation)
- Solde & pagination par curseur
- API Comptes (Accounts)
- API Catégories
- Virements & mapping transactions
- Config build Angular
- API Tags
- Conventions projet & services dev
- Service d'authentification
- Routage auth (front)
- Conventions Angular (docs)
- Client API (front)
- Utilitaires EUR & labels
- OAuth Google
- Câblage des modules Nest
- Gestion d'erreurs & logs redacted
- Module auth & cookies de session
- Dépendances API
- Seed, garde CSRF & mail
- Service de solde & client Prisma
- Harnais de test d'isolation
- Bootstrap des tests e2e
- Dépendances cœur API
- Endpoints AuthController
- Tests pages transaction
- Dépendances dev API
- BalanceController
- Config TS API
- Dépendances web
- DTO auth
- Tests page comptes
- Config package shared/api
- Composant AccountsPage
- Config monorepo (workspaces, eslint)
- Config TS shared
- Dépendances Angular
- Helpers de test E0/E14
- Scripts npm API
- Config TS build API
- Dépendances dev web
- Helpers conversion monétaire
- Config Jest
- Test health probe
- Scripts npm web
- Page formulaire virement
- Page formulaire transaction
- Enum IntervalUnit
- Tests des enums
- Test lint E2
- Page connexion
- Page vérification email
- Dépendances lint racine
- Scripts npm racine
- Dépendances dev shared
- Config Prisma

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 49 edges
2. `PrismaService` - 38 edges
3. `AuthUser` - 33 edges
4. `CurrentUser` - 33 edges
5. `LocalDate` - 30 edges
6. `SPEC.md (specification v1)` - 27 edges
7. `PLAN.md (ordered steps E0-E32)` - 25 edges
8. `@angular/core` - 24 edges
9. `UpdateTransactionDto` - 23 edges
10. `TrackingType` - 23 edges

## Surprising Connections (you probably didn't know these)
- `CI pipeline (GitHub Actions)` --semantically_similar_to--> `Dev Postgres service (docker-compose.dev.yml)`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → docker-compose.dev.yml
- `OpeningBalanceDto` --references--> `LocalDate`  [EXTRACTED]
  apps/api/src/accounts/accounts.dto.ts → packages/shared/src/local-date.ts
- `Cursor` --references--> `LocalDate`  [EXTRACTED]
  apps/api/src/common/cursor.ts → packages/shared/src/local-date.ts
- `IsLocalDate()` --indirect_call--> `isLocalDate()`  [INFERRED]
  apps/api/src/common/is-local-date.ts → packages/shared/src/local-date.ts
- `CreateTransferDto` --implements--> `CreateTransferInput`  [EXTRACTED]
  apps/api/src/transfers/transfers.dto.ts → packages/shared/src/dto/transfer.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CLAUDE.md domain pitfalls (Règles du domaine)** — money_centimes_rule, local_date_rule, user_isolation_rule, pure_engine_rule, transfer_invariant, prisma_migrations_versioned_rule, no_secrets_rule [EXTRACTED 1.00]
- **Authentication/security mechanisms (SPEC §5)** — jwt_auth, csrf_protection, google_oauth, no_local_storage_auth_rule [INFERRED 0.85]
- **Dev-only Docker services (Postgres, MinIO, Mailpit)** — docker_compose_dev_db, docker_compose_dev_minio, docker_compose_dev_mailpit [EXTRACTED 1.00]

## Communities (58 total, 15 thin omitted)

### Community 0 - "Solde & pagination par curseur"
Cohesion: 0.05
Nodes (42): BalanceQueryDto, Cursor, decodeCursor(), encodeCursor(), IsLocalDate(), CreateTransactionDto, Present(), TransactionListQueryDto (+34 more)

### Community 1 - "API Comptes (Accounts)"
Cohesion: 0.05
Nodes (19): AccountsController, CreateAccountDto, OpeningBalanceDto, trim(), UpdateAccountDto, AccountsModule, AccountsService, toAccountDto() (+11 more)

### Community 2 - "API Catégories"
Cohesion: 0.08
Nodes (12): CategoriesController, CreateCategoryDto, DeleteCategoryQueryDto, trim(), UpdateCategoryDto, CategoriesService, toCategoryDto(), visibleTo() (+4 more)

### Community 3 - "Virements & mapping transactions"
Cohesion: 0.08
Nodes (11): JwtAuthGuard, include, toLocalDate(), toTransactionDto(), TransfersController, CreateTransferDto, Present(), UpdateTransferDto (+3 more)

### Community 4 - "Config build Angular"
Cohesion: 0.05
Nodes (43): build, serve, test, builder, configurations, defaultConfiguration, options, cli (+35 more)

### Community 5 - "API Tags"
Cohesion: 0.08
Nodes (10): TagsController, TagBodyDto, trim(), TagsModule, mapError(), TagsService, toTagDto(), TagDto (+2 more)

### Community 6 - "Conventions projet & services dev"
Cohesion: 0.14
Nodes (32): Session (signal-based auth state, no client-side token), apps/web Angular conventions, AppComponent shell template (app.html), index.html (app bootstrap host), CLAUDE.md (root rules), CSRF double-submit (X-CSRF-Token header = csrf_token cookie), Dev Postgres service (docker-compose.dev.yml), Dev Mailpit service (SMTP test inbox) (+24 more)

### Community 7 - "Service d'authentification"
Cohesion: 0.11
Nodes (15): appUrl(), AuthService, consumeEmailToken(), randomToken(), REFRESH_GRACE_MS, Session, sha256(), argon2Async (+7 more)

### Community 8 - "Routage auth (front)"
Cohesion: 0.11
Nodes (14): authed, placeholder(), authGuard(), emailValidators, errorMessage(), passwordValidators, ForgotPasswordPage, GOOGLE_ERRORS (+6 more)

### Community 9 - "Conventions Angular (docs)"
Cohesion: 0.09
Nodes (14): Web App Copilot Instructions, Web App README, Angular CLI 21.2.24, Vitest Test Runner, App, appConfig, router-outlet, routes (+6 more)

### Community 10 - "Client API (front)"
Cohesion: 0.12
Nodes (10): API_BASE, ApiClient, Params, toParams(), USER, provideApiHttp(), sessionInterceptor(), unauthorized (+2 more)

### Community 11 - "Utilitaires EUR & labels"
Cohesion: 0.20
Nodes (10): amountValidator(), EurPipe, today(), openingAmountValidator(), RESERVED, CATEGORY_LABELS, categoryLabel(), TRACKING_TYPE_LABELS (+2 more)

### Community 12 - "OAuth Google"
Cohesion: 0.12
Nodes (7): GoogleController, GoogleProfile, GoogleService, ISSUERS, profileFromIdToken(), claims, NOW

### Community 13 - "Câblage des modules Nest"
Cohesion: 0.10
Nodes (8): BalanceModule, CategoriesModule, HealthController, PURGE_AFTER_DAYS, PurgeJob, PrismaModule, @nestjs/core, @nestjs/schedule

### Community 14 - "Gestion d'erreurs & logs redacted"
Cohesion: 0.14
Nodes (10): AllExceptionsFilter, issueCsrfCookie(), redact(), RedactingLogger, Env, loadEnv(), valid, bootstrap() (+2 more)

### Community 15 - "Module auth & cookies de session"
Cohesion: 0.17
Nodes (14): setSession(), AuthModule, ACCESS_COOKIE, ACCESS_TTL_MS, accessCookie, base, csrfCookie, OAUTH_COOKIE (+6 more)

### Community 16 - "Dépendances API"
Cohesion: 0.10
Nodes (20): rxjs, name, private, version, cookie-parser, helmet, jest, @nestjs/platform-express (+12 more)

### Community 17 - "Seed, garde CSRF & mail"
Cohesion: 0.12
Nodes (11): SYSTEM_CATEGORIES, CSRF_COOKIE, CsrfGuard, SAFE_METHODS, CallOptions, Jar, jarOf(), setCookies() (+3 more)

### Community 18 - "Service de solde & client Prisma"
Cohesion: 0.19
Nodes (4): balanceSql(), PrismaService, UsersController, @nestjs/common

### Community 19 - "Harnais de test d'isolation"
Cohesion: 0.13
Nodes (9): BidonController, listRoutes(), accountOfB(), IsolationCheck, isolationRegistry, publicRoutes, tagOfB(), transactionOfB() (+1 more)

### Community 20 - "Bootstrap des tests e2e"
Cohesion: 0.34
Nodes (7): seed(), AppModule, createTwoUsers(), TestUser, TwoUsers, @nestjs/testing, supertest

### Community 21 - "Dépendances cœur API"
Cohesion: 0.12
Nodes (16): dependencies, class-transformer, class-validator, cookie-parser, helmet, @nestjs/common, @nestjs/core, @nestjs/jwt (+8 more)

### Community 23 - "Tests pages transaction"
Cohesion: 0.17
Nodes (11): CATEGORIES, COURANT, LIVRET, navigate(), openAccounts(), openExpense(), openTransfer(), stable() (+3 more)

### Community 24 - "Dépendances dev API"
Cohesion: 0.14
Nodes (14): devDependencies, jest, @nestjs/testing, prisma, supertest, ts-jest, tsx, @types/cookie-parser (+6 more)

### Community 25 - "BalanceController"
Cohesion: 0.18
Nodes (3): BalanceController, BalanceService, AccountBalanceDto

### Community 26 - "Config TS API"
Cohesion: 0.15
Nodes (12): compilerOptions, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, module, outDir, skipLibCheck, sourceMap (+4 more)

### Community 27 - "Dépendances web"
Cohesion: 0.15
Nodes (12): rxjs, vitest, name, private, version, @angular/build, @angular/cli, @angular/compiler (+4 more)

### Community 28 - "DTO auth"
Cohesion: 0.33
Nodes (5): ForgotPasswordDto, LoginDto, ResetPasswordDto, SignupDto, VerifyEmailDto

### Community 29 - "Tests page comptes"
Cohesion: 0.21
Nodes (7): balanceUrl(), COURANT, open(), respond(), stable(), USER, WALLET

### Community 30 - "Config package shared/api"
Cohesion: 0.18
Nodes (10): typescript, vitest, main, name, private, scripts, build, test (+2 more)

### Community 32 - "Config monorepo (workspaces, eslint)"
Cohesion: 0.22
Nodes (8): allowScripts, @prisma/engines@7.10.0, name, packageManager, private, workspaces, @eslint/js, typescript-eslint

### Community 33 - "Config TS shared"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, module, outDir, rootDir, skipLibCheck, strict, target (+1 more)

### Community 34 - "Dépendances Angular"
Cohesion: 0.22
Nodes (9): dependencies, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/router, rxjs (+1 more)

### Community 36 - "Scripts npm API"
Cohesion: 0.25
Nodes (8): scripts, build, db:migrate, db:reset, db:seed, pretest, start, test

### Community 37 - "Config TS build API"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, types, exclude, extends, include, ./tsconfig.json

### Community 38 - "Dépendances dev web"
Cohesion: 0.25
Nodes (8): devDependencies, @angular/build, @angular/cli, @angular/compiler-cli, jsdom, prettier, typescript, vitest

### Community 39 - "Helpers conversion monétaire"
Cohesion: 0.39
Nodes (4): assertCents(), centsToEuros(), EUR, formatEur()

### Community 40 - "Config Jest"
Cohesion: 0.29
Nodes (7): jest, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform, ^.+\\.ts$

### Community 42 - "Scripts npm web"
Cohesion: 0.33
Nodes (6): scripts, build, ng, start, test, watch

### Community 45 - "Enum IntervalUnit"
Cohesion: 0.40
Nodes (5): IntervalUnit, DAY, MONTH, WEEK, YEAR

### Community 50 - "Dépendances lint racine"
Cohesion: 0.50
Nodes (4): devDependencies, eslint, @eslint/js, typescript-eslint

### Community 51 - "Scripts npm racine"
Cohesion: 0.50
Nodes (4): scripts, build, lint, test

### Community 52 - "Dépendances dev shared"
Cohesion: 0.67
Nodes (3): devDependencies, typescript, vitest

## Knowledge Gaps
- **37 isolated node(s):** `<app-root> element`, `Vitest Test Runner`, `@types/cookie-parser`, `@types/express`, `@types/jest` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 391 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@nestjs/common` connect `Service de solde & client Prisma` to `Solde & pagination par curseur`, `API Comptes (Accounts)`, `API Catégories`, `Virements & mapping transactions`, `API Tags`, `Service d'authentification`, `OAuth Google`, `Câblage des modules Nest`, `Gestion d'erreurs & logs redacted`, `Module auth & cookies de session`, `Dépendances API`, `Seed, garde CSRF & mail`, `Harnais de test d'isolation`, `Bootstrap des tests e2e`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **What connects `<app-root> element`, `Vitest Test Runner`, `@types/cookie-parser` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Solde & pagination par curseur` be split into smaller, more focused modules?**
  _Cohesion score 0.053763440860215055 - nodes in this community are weakly interconnected._
- **Why does `typescript` connect `Config package shared/api` to `Dépendances API`, `Dépendances web`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Should `API Comptes (Accounts)` be split into smaller, more focused modules?**
  _Cohesion score 0.050837496326770495 - nodes in this community are weakly interconnected._
- **Why does `PrismaService` connect `Service de solde & client Prisma` to `Solde & pagination par curseur`, `API Comptes (Accounts)`, `API Catégories`, `Virements & mapping transactions`, `API Tags`, `Service d'authentification`, `OAuth Google`, `Câblage des modules Nest`, `Seed, garde CSRF & mail`, `Bootstrap des tests e2e`, `BalanceController`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Should `API Catégories` be split into smaller, more focused modules?**
  _Cohesion score 0.07673469387755102 - nodes in this community are weakly interconnected._