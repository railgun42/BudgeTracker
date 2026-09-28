# Graph Report - BudgeTracker  (2026-09-28)

## Corpus Check
- Corpus is ~3,983 words - fits in a single context window. You may not need a graph.

## Summary
- 142 nodes · 199 edges · 11 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.83)
- Token cost: 60,711 input · 0 output

## Community Hubs (Navigation)
- Angular Build Targets
- Transaction Domain Models
- NPM Package Manifest
- App Bootstrap & Routing
- Account & Recurrence Models
- Angular Workspace Config
- Angular Coding Guidelines
- Runtime Dependencies
- Dev Dependencies
- Build Options
- NPM Scripts

## God Nodes (most connected - your core abstractions)
1. `Transaction` - 12 edges
2. `TypeTransaction` - 9 edges
3. `IntervalUnit` - 8 edges
4. `Category` - 8 edges
5. `Recurrence` - 8 edges
6. `Tag` - 8 edges
7. `TransactionTemplate` - 8 edges
8. `Web App Claude Instructions (CLAUDE.md)` - 8 edges
9. `web` - 7 edges
10. `Account` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Web App Copilot Instructions` --semantically_similar_to--> `Web App Claude Instructions (CLAUDE.md)`  [INFERRED] [semantically similar]
  apps/web/.github/copilot-instructions.md → apps/web/.claude/CLAUDE.md
- `TransactionTemplate` --references--> `TypeTransaction`  [EXTRACTED]
  apps/web/src/app/models/transactionTemplate.ts → apps/web/src/app/enums/typeTransaction.ts
- `Account` --references--> `Transaction`  [EXTRACTED]
  apps/web/src/app/models/account.ts → apps/web/src/app/models/transaction.ts
- `TransactionTemplate` --references--> `Category`  [EXTRACTED]
  apps/web/src/app/models/transactionTemplate.ts → apps/web/src/app/models/category.ts
- `Recurrence` --references--> `Transaction`  [EXTRACTED]
  apps/web/src/app/models/recurrence.ts → apps/web/src/app/models/transaction.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Angular v20+ Coding Guidelines for AI Assistants** — apps_web__claude_claude_standalone_components, apps_web__claude_claude_signals_state_management, apps_web__claude_claude_onpush_change_detection, apps_web__claude_claude_native_control_flow, apps_web__claude_claude_inject_function [EXTRACTED 1.00]
- **Angular App Bootstrap (index.html -> app-root -> App template -> router-outlet)** — apps_web_src_index, apps_web_src_index_app_root, apps_web_src_app_app, apps_web_src_app_app_router_outlet [INFERRED 0.85]

## Communities (11 total, 0 thin omitted)

### Community 0 - "Angular Build Targets"
Cohesion: 0.11
Nodes (20): build, serve, test, builder, configurations, defaultConfiguration, development, production (+12 more)

### Community 1 - "Transaction Domain Models"
Cohesion: 0.24
Nodes (7): TypeTransaction, CREDIT, DEBIT, Attachment, Category, Tag, Transaction

### Community 2 - "NPM Package Manifest"
Cohesion: 0.12
Nodes (16): name, packageManager, private, version, @angular/build, @angular/cli, @angular/common, @angular/compiler (+8 more)

### Community 3 - "App Bootstrap & Routing"
Cohesion: 0.18
Nodes (12): Web App README, Angular CLI 21.2.24, Vitest Test Runner, App, appConfig, routes, index.html Host Page, <app-root> element (+4 more)

### Community 4 - "Account & Recurrence Models"
Cohesion: 0.22
Nodes (9): IntervalUnit, DAY, MONTH, WEEK, YEAR, Account, Recurrence, TransactionTemplate (+1 more)

### Community 5 - "Angular Workspace Config"
Cohesion: 0.13
Nodes (14): cli, packageManager, newProjectRoot, projects, web, $schema, style, @schematics/angular:component (+6 more)

### Community 6 - "Angular Coding Guidelines"
Cohesion: 0.27
Nodes (10): Web App Claude Instructions (CLAUDE.md), inject() over Constructor Injection, Lazy Loading Feature Routes, Native Control Flow (@if/@for/@switch), OnPush Change Detection, Signals State Management (signal/computed/update/set), Standalone Components (no NgModules), WCAG AA / AXE Accessibility Requirements (+2 more)

### Community 7 - "Runtime Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/router, rxjs (+1 more)

### Community 8 - "Dev Dependencies"
Cohesion: 0.25
Nodes (8): devDependencies, @angular/build, @angular/cli, @angular/compiler-cli, jsdom, prettier, typescript, vitest

### Community 9 - "Build Options"
Cohesion: 0.33
Nodes (6): options, assets, browser, inlineStyleLanguage, styles, tsConfig

### Community 10 - "NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, ng, start, test, watch

## Knowledge Gaps
- **70 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+65 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 77 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Runtime Dependencies` to `NPM Package Manifest`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `@angular/router` connect `App Bootstrap & Routing` to `NPM Package Manifest`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `@angular/core` connect `App Bootstrap & Routing` to `NPM Package Manifest`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _70 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Angular Build Targets` be split into smaller, more focused modules?**
  _Cohesion score 0.11052631578947368 - nodes in this community are weakly interconnected._
- **Should `NPM Package Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Angular Workspace Config` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._