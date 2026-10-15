# Charte graphique BudgeTracker (E43)

> Référence pour les sessions « pages ». Implémentation : `apps/web/src/styles.scss` (tokens + composants globaux) et `apps/web/src/app/app.{html,scss,ts}` (coquille).
> Règle d'or : **une page n'invente ni couleur, ni taille, ni espacement** ; elle utilise les tokens et les classes ci-dessous. Un style local (`styles:` du composant) ne sert qu'à la mise en page propre à l'écran.

## 1. Direction

**Encre de chéquier** : bleu encre profond sur papier blanc légèrement bleuté. Sobre, rassurant : on manipule de l'argent.

- **Une seule note appuyée : les montants** (chiffres tabulaires, gras, signe toujours affiché, vert revenu / rouge dépense). Tout le reste est discret.
- Relief : bordure fine de 1 px, ombre quasi invisible. Pas de dégradé ni d'ombre décorative.
- Densité : aérée (cibles tactiles de 44 px) ; tableaux compacts (historique, stats, admin).
- Formes : rayon de 8 px (`--radius`), 4 px pour les éléments internes, pilule pour les pastilles.
- Police système (aucun téléchargement).
- Animations expressives mais **toujours en réponse à une action** (ouverture, confirmation), sauf l'entrée de page. Toutes coupées par `prefers-reduced-motion`.

## 2. Tokens

### Couleurs

| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `--color-bg` | `#f3f5f8` | `#0e1520` | fond de page |
| `--color-surface` | `#ffffff` | `#162030` | cartes, en-tête, champs, menus |
| `--color-surface-2` | `#eaeef4` | `#1e2a3c` | en-tête de tableau, survol, champ désactivé |
| `--color-text` | `#16202e` | `#e5eaf1` | texte courant |
| `--color-text-muted` | `#4f5b6c` | `#a2adbd` | métadonnées, aide (`.muted`) |
| `--color-border` | `#d6dce5` | `#2c3a4f` | séparations décoratives |
| `--color-border-strong` | `#7c8798` | `#6f7d92` | contour de champ, bouton secondaire (≥ 3:1) |
| `--color-primary` | `#1d4580` | `#8db4f2` | bouton principal, liens, lien actif |
| `--color-primary-hover` | `#163667` | `#aac8f7` | survol du primaire |
| `--color-on-primary` | `#ffffff` | `#0c1a30` | texte sur primaire |
| `--color-primary-soft` | `#e4ebf6` | `#1f3150` | fond du lien actif, avatar |
| `--color-focus` | `#1d4580` | `#8db4f2` | anneau de focus |
| `--color-credit` / `--color-success` | `#16693b` | `#6fd39c` | revenu, succès |
| `--color-debit` / `--color-error` | `#b02a1f` | `#ff968a` | dépense, solde négatif, erreur |
| `--color-warning` | `#8a4b00` | `#f2c06a` | texte d'avertissement |
| `--color-info-bg` | `#e4ebf6` | `#1f3150` | fond bandeau info |
| `--color-success-bg` | `#e5f3ea` | `#163225` | fond bandeau succès |
| `--color-error-bg` | `#fbe9e7` | `#3a1e1d` | fond bandeau erreur |
| `--color-warning-bg` | `#fdf1df` | `#35290f` | fond bandeau avertissement |
| `--color-overlay` | encre 45 % | noir 60 % | voile derrière tiroir/modale |

Le rouge n'est **jamais** une couleur de marque : il signifie dépense, solde négatif ou erreur.

### Contrastes mesurés (WCAG 2.x, seuil AA)

Seuil 4,5:1 pour le texte, 3:1 pour les composants non textuels (contour de champ, focus). Script de mesure : formule de luminance relative WCAG, rejouable à chaque changement de couleur.

| Couple | Clair | Sombre |
|---|---|---|
| texte / fond | 15,02 | 15,15 |
| texte / surface | 16,40 | 13,54 |
| texte / surface-2 | 14,09 | 11,97 |
| texte atténué / fond | 6,31 | 8,06 |
| texte atténué / surface | 6,90 | 7,21 |
| texte atténué / surface-2 | 5,92 | 6,37 |
| primaire / surface | 9,48 | 7,75 |
| primaire / fond | 8,68 | 8,67 |
| primaire / primaire-soft (lien actif) | 7,91 | 6,16 |
| texte sur primaire | 9,48 | 8,24 |
| texte sur primaire survolé | 11,95 | 10,21 |
| revenu / surface | 6,74 | 8,94 |
| revenu / fond | 6,17 | 10,00 |
| revenu / surface-2 | 5,78 | 7,90 |
| dépense / surface | 6,57 | 7,78 |
| dépense / fond | 6,01 | 8,70 |
| dépense / surface-2 | 5,64 | 6,88 |
| texte / fond info | 13,68 | 10,77 |
| succès / fond succès | 5,88 | 7,56 |
| texte / fond succès | 14,33 | 11,45 |
| erreur / fond erreur | 5,60 | 7,22 |
| texte / fond erreur | 13,99 | 12,56 |
| avertissement / fond avertissement | 6,10 | 8,49 |
| texte / fond avertissement | 14,70 | 11,77 |
| contour de champ / surface (≥ 3) | 3,64 | 3,91 |
| focus / surface (≥ 3) | 9,48 | 7,75 |
| focus / fond (≥ 3) | 8,68 | 8,67 |

Tous les couples passent AA. Ajouter une couleur ⇒ mesurer ses couples dans les deux thèmes et compléter ce tableau.

### Typographie

`--font-sans` : police système (`system-ui`, Segoe UI, San Francisco, Roboto…).

| Token | Taille | Usage |
|---|---|---|
| `--text-xs` | 12 px | pastilles |
| `--text-sm` | 14 px | libellés, aide, tableaux, pied de page |
| `--text-base` | 16 px | texte courant |
| `--text-lg` | 18 px | titres de carte, `h3` |
| `--text-xl` | 22 px | `h2`, solde (`.balance`) |
| `--text-2xl` | 28 px | `h1` |
| `--text-3xl` | 36 px | chiffre clé (ex. solde total du tableau de bord) |

Graisses : `--weight-regular` 400, `--weight-medium` 500, `--weight-bold` 650. Interlignage `--leading` 1,5 ; titres `--leading-tight` 1,2.
Pas de texte en capitales, pas de mot isolé mis en couleur dans un titre.

### Espacements, rayons, ombres, tailles

- Espacement (base 4 px) : `--space-1` 4 px, `--space-2` 8 px, `--space-3` 16 px, `--space-4` 24 px, `--space-5` 32 px, `--space-6` 48 px.
- Rayons : `--radius-sm` 4 px, `--radius` 8 px, `--radius-pill`.
- Ombres : `--shadow-1` (cartes, quasi invisible), `--shadow-2` (menus, bannière « Annuler », éléments flottants).
- `--tap` 44 px (cible tactile minimale), `--header-height` 56 px, `--sidebar-width` 240 px, `--content-max` 1024 px.

### Animations

`--duration-fast` 120 ms (survol, appui), `--duration` 200 ms (menus, bandeaux), `--duration-slow` 320 ms (tiroir, entrée de page, confirmation) ; courbe `--ease-out`.
Images clés disponibles : `enter-up`, `enter-down`, `pop`, `confirm`. Sous `prefers-reduced-motion: reduce`, toutes les durées tombent à ~0.

## 3. Thème clair / sombre

- Par défaut, le thème suit le système (`prefers-color-scheme`).
- Le choix Auto / Clair / Sombre se fait dans le menu du compte. Il pose `data-theme="light|dark"` sur `<html>` et se mémorise dans `localStorage.theme` (préférence d'affichage, aucune donnée métier). « Auto » retire l'attribut.
- CSS : bloc `:root:not([data-theme="light"])` sous `@media (prefers-color-scheme: dark)`, et `:root[data-theme="dark"]` ; les deux partagent le mixin `dark-tokens`. `color-scheme` suit le thème, ce qui adapte les contrôles natifs (date, select, barres de défilement).
- Une page n'écrit **jamais** de couleur en dur : avec les tokens, le thème sombre est gratuit.

## 4. Coquille

- **Mobile (< 768 px)** : en-tête collant [☰][logo BudgeTracker] … [cloche][+][avatar]. Le ☰ ouvre la navigation principale en tiroir à gauche (`popover` natif : Échap, clic extérieur et retour du focus gérés par le navigateur). Sous 480 px, « Transaction » est masqué visuellement (le nom accessible reste « + Transaction ») ; sous 340 px, c'est le nom du logo.
- **Bureau (≥ 768 px)** : barre latérale fixe à gauche (240 px), contenu limité à 1024 px.
- Navigation principale : Tableau de bord, Comptes, Historique, Récurrences, Catégories, Statistiques, Simulations (+ Administration pour un admin). Le lien actif porte `aria-current="page"`, un fond `--color-primary-soft` et un trait d'encre de 3 px à gauche.
- **Menu du compte** (avatar aux initiales) : nom et e-mail, Mon compte, Donner mon avis, Thème, Se déconnecter.
- Tout menu ouvert se referme après une navigation.
- Lien d'évitement « Aller au contenu » (`.skip-link`), visible au focus.
- Entrée de page : chaque écran routé apparaît en `enter-up` (320 ms). C'est le seul mouvement non déclenché par l'utilisateur.

## 5. Composants (classes globales)

### Boutons

| Classe | Usage |
|---|---|
| `.button` | action validante, **une seule par zone** (Enregistrer, Créer, Virer) |
| `.button.button-secondary` | Modifier, Supprimer, Annuler, Filtrer en second plan |
| `.link-button` | action légère dans un texte (« Recharger », « Retirer… ») |

Hauteur minimale de 44 px, léger enfoncement à l'appui, `:disabled` à 55 % d'opacité. Libellé = verbe d'action (« Enregistrer le taux », pas « Valider »). Ne pas ajouter de flèche « → ».

### Champs de formulaire

```html
<form class="form">
  <div class="field">
    <label for="amount">Montant (€)</label>
    <input id="amount" inputmode="decimal" aria-describedby="amount-hint amount-error" [attr.aria-invalid]="invalid" />
    <p id="amount-hint" class="field-hint">Montant positif, ex. 12,34.</p>
    <p id="amount-error" class="field-error">Saisissez un montant supérieur à 0.</p>
  </div>
  <div class="field">
    <label class="checkbox"><input type="checkbox" /> Proposer cette catégorie à tous</label>
  </div>
</form>
```

- `.form` : une colonne, 448 px au maximum ; `.field` : libellé au-dessus.
- Champ invalide : `aria-invalid="true"` ⇒ contour rouge doublé. Erreur dans `.field-error`, reliée par `aria-describedby`.
- Désactivé : fond `--color-surface-2`, texte atténué.
- Montants : `inputmode="decimal"` ⇒ chiffres tabulaires automatiques.
- Case à cocher et bouton radio : `.checkbox` sur le `<label>` (texte à droite, couleur `accent-color` primaire).
- Champ fichier : le bouton natif est stylé comme un bouton secondaire.
- Groupe de champs : `<fieldset class="field"><legend>…</legend>…</fieldset>` (sans cadre natif), ex. le sens Dépense / Revenu.
- Question obligatoire mise en évidence : `<fieldset class="field question">` (fond `--color-surface-2`, radios en `.checkbox`), ex. « Compter dans le solde ? ».
- Montant mis en avant : `<div class="amount-input">` autour de l'`<input inputmode="decimal">` (22 px, gras). Signe facultatif devant : `<span class="amount-sign debit" aria-hidden="true">−</span>` ou `.credit` avec « + » (le sens est déjà annoncé par le champ qui le choisit).

### Carte et liste

```html
<ul class="cards">
  <li class="card">
    <h2 class="card-title">Compte courant</h2>
    <p class="muted">Normal</p>
    <p class="balance">3 168,30 €</p>
    <div class="card-actions">…</div>
  </li>
</ul>
```

Surface blanche, bordure 1 px, `--shadow-1`, marge intérieure 16/24 px. Ne pas imbriquer de cartes.

### Bandeaux d'alerte

| Classe | Rôle ARIA | Usage |
|---|---|---|
| `.alert` | `status` | information (fond `--color-info-bg`, filet primaire à gauche) |
| `.alert.alert-success` | `status` | succès |
| `.alert.alert-warning` | `status` | avertissement non bloquant (taux manquant, date antérieure…) |
| `.alert.alert-error` | `alert` | erreur ; l'action « Recharger » se place dedans en `.link-button` |

Apparition en `enter-down`. Message : dire ce qui s'est passé et comment corriger, sans s'excuser.

`.alert.toast` : bandeau flottant en bas de l'écran (ombre `--shadow-2`), hors du flux de la page, avec un bouton « Fermer » en `.link-button`. Sert au succès d'une saisie en modale (« Transaction enregistrée. »), avec `.confirm-pop`. Effacé à la navigation suivante.

### Bannière « Annuler »

Composant `<app-undo-banner [message]="…" (undo)="…">` (`shared-ui/undo-banner.ts`) : `.alert.undo-banner`, message à gauche, bouton secondaire « Annuler » à droite, ombre `--shadow-2`. À utiliser après chaque suppression logique.

### Modale

`<dialog class="modal" aria-labelledby="…">` ouvert par `showModal()` : Échap, piège à focus, page derrière inerte et voile `--color-overlay` sont natifs. Titre `h2` en tête, `.form` pleine largeur, puis une ligne `.actions` [action validante][Annuler]. Apparition en `enter-up`. Fermer par `close()` après un enregistrement réussi ; écouter `(close)` pour remettre le formulaire à zéro. La page derrière étant inerte, une erreur serveur s'affiche **aussi** dans la modale. Première utilisation : comptes (création, modification, taux).

**Saisie rapide** (transaction, virement) : une seule `<dialog>` dans la coquille, pilotée par le service `QuickEntry` (`core/quick-entry.ts`). Pour l'ouvrir depuis n'importe quelle page : `quick.open.set('transaction' | 'transfer')`. Les formulaires sont chargés à l'ouverture (`@defer`) avec `[modal]="true"` (titre `h2#entry-title`, bouton Annuler). Après un succès, `quick.saved` émet le message : la coquille ferme la modale et affiche un `.alert.toast`, et une page qui s'abonne à `quick.saved` relit ses données (Comptes le fait). Les routes `/transactions/new` et `/transfers/new` restent des pages pleines.

### Tableau

```html
<div class="scroll">
  <table>
    <caption>Évolution mensuelle</caption>
    <thead><tr><th scope="col">Mois</th><th scope="col" class="num">Revenus</th></tr></thead>
    <tbody><tr><td>octobre 2026</td><td class="num credit">2 100,00 €</td></tr></tbody>
  </table>
</div>
```

Compact (8/16 px), en-tête sur `--color-surface-2`, survol de ligne, chiffres tabulaires. `.num` aligne à droite. `.scroll` assure le défilement horizontal sur mobile.

### Montants

| Classe | Effet |
|---|---|
| `.amount` | gras, chiffres tabulaires, sans retour à la ligne |
| `.balance` | solde mis en avant (22 px, gras) |
| `.num` | colonne numérique alignée à droite |
| `.credit` | revenu (vert) |
| `.debit`, `.negative` | dépense, solde négatif (rouge) |

Pipe `signedEur` (`core/money.ts`) : `{{ cents | signedEur }}` → « −54,20 € » (U+2212) / « +2 100,00 € » / « 0,00 € ». À utiliser pour tout montant signé affiché.

**Toujours afficher le signe** (`+2 100,00 €`, `−54,20 €`) : la couleur ne porte jamais seule l'information.

### Pastilles

- `.badge` : compteur (« 3 », « 99+ »), pilule primaire, apparition en `pop`.
- `.badge.badge-neutral` : statut (« archivée », « En attente », « Acceptée »).
- `.category-dot` : pastille ronde de 12 px devant un libellé, couleur de la catégorie (`[style.background-color]`, sinon celle du parent), neutre (`--color-border-strong`) sans couleur. Décorative : `aria-hidden="true"`, le nom de la catégorie reste écrit à côté. Première utilisation : historique.
- `.category-icon` : icône de catégorie racine, `<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="…" /></svg>` ; carré de 32 px (`--space-5`), fond `--color-primary-soft`, trait 2 px `--color-primary` (7,91 / 6,16:1). Tracés dans `shared-ui/category-icons.ts` (`categoryIcon(c)` par `nameKey` seedé, y compris les techniques Virement / Espèces / Intérêts / Solde de départ ; étiquette pour les perso et celles de l'admin ; `NO_CATEGORY_ICON` sans catégorie). Une sous-catégorie prend l'icône de son parent. Décorative, le nom reste écrit. Utilisée dans Mes catégories et l'historique (à la place de `.category-dot`).

### Menu déroulant

`.menu` sur un élément `[popover]` déclenché par un `<button popovertarget="id">`. L'appelant fixe la position (`inset`). Enfants directs `<a>` / `<button>` en lignes de 44 px ; un dernier `<button>` est séparé par un filet (déconnexion, action destructive).

### Sélecteur segmenté

`.segmented` contenant des `<button aria-pressed>` (44 px de haut) : thème, **Dépense / Revenu** dans la saisie de transaction (dans un `fieldset.field` avec la légende « Sens »). Le bouton pressé est plein primaire.

### Confirmation

`.confirm-pop` sur l'élément créé ou modifié : bref fond succès et léger rebond (320 ms). À poser par la page après un enregistrement réussi.

## 6. Focus et accessibilité

- `:focus-visible` global : anneau de 2 px `--color-focus`, décalé de 2 px (≥ 3:1 sur tous les fonds).
- Cibles tactiles d'au moins 44 px (`--tap`).
- Menus et tiroir : `popover` natif (Échap, clic extérieur, retour du focus).
- `.visually-hidden` pour les textes destinés uniquement aux lecteurs d'écran.
- `prefers-reduced-motion` : animations et transitions coupées globalement.

## 7. À reprendre dans les sessions pages (hors périmètre E43)

- Supprimer les styles locaux qui redéfinissent `.card`, `.cards`, `.actions`, `.scroll`, `.negative`, `.balance`… dès qu'ils doublonnent la charte (le style local l'emporte sur le global).
- Cloche (`features/notifications/notification-bell.ts`) : remplacer l'emoji 🔔 par une icône SVG `currentColor` ; la pastille peut utiliser `.badge`.
- Signe moins : le format actuel affiche « -720,00 € » (trait d'union) ; viser « −720,00 € » (U+2212) et « +» explicite partout. Pipe `signedEur` disponible ; fait dans l'historique (§3.5).
- ~~Historique : les boutons Filtrer / Effacer s'étirent dans la grille de filtres ; les regrouper dans une ligne `.actions`.~~ Fait (§3.5, 2026-10-15).
- ~~Saisie de transaction : sens Dépense / Revenu en `.segmented`, bien visible.~~ Fait (§3.3, 2026-10-15).
- Alerte « taux manquant » : passer en `.alert-warning` plutôt qu'en `.alert-error`.
- Dates affichées « 2026-10-15 » : format lisible (« 15 oct. 2026 »). Fait dans l'historique (`Intl.DateTimeFormat` fr-FR en UTC, affichage seulement).
