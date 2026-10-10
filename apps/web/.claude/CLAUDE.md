# Front Angular (apps/web)

- Ne PAS écrire `standalone: true` (défaut depuis Angular 20).
- État : signals + `computed()` ; jamais `mutate`, utiliser `update`/`set`.
- `input()` / `output()` au lieu des décorateurs ; pas de `@HostBinding`/`@HostListener` (utiliser `host: {}`).
- `ChangeDetectionStrategy.OnPush` sur chaque composant ; `inject()` plutôt que l'injection par constructeur.
- Templates : `@if/@for/@switch` ; pas de `ngClass`/`ngStyle` (bindings `class`/`style`).
- Formulaires réactifs uniquement.
- Routes de fonctionnalités en lazy loading ; `NgOptimizedImage` pour les images statiques.
- Accessibilité : doit passer AXE et WCAG AA (contrastes, focus, ARIA, libellés de formulaire).
- Aucun token ni donnée métier dans `localStorage`/`sessionStorage`.
