# Remarques d'utilisation

> Carnet de remarques à remplir pendant l'usage de l'appli. Un agent le lit pour mettre à jour `PLAN.md` (nouvelles étapes, avec « Vérif »). Le « quoi » reste dans `SPEC.md` : une remarque qui change le comportement attendu doit aussi le dire.

## Comment remplir

- Une remarque = un bloc `### R-<n>` ci-dessous. Numérotez dans l'ordre, ne réutilisez pas un numéro.
- Écrivez le constat tel que vous le voyez, pas la solution. La solution peut venir après, dans « Souhait ».
- Indiquez l'écran (route ou nom dans le menu) et, si possible, l'appareil (téléphone 360 px, bureau 1280 px).
- Si c'est un bug (quelque chose ne marche pas), cochez **Bug**. Sinon, c'est une amélioration ou un nouveau besoin.
- Une remarque déjà traitée ? Ne la supprimez pas : passez son statut à `fait` (l'agent le fera aussi).

## Remarques

### R-1 — Modification d'une transactions
- **Écran** : /history
- **Type** : amélioration/manque
- **Appareil** : les deux
- **Constat** : la modification d'une transaction ne permet de modifier que le montant, la date et le libéllé
- **Souhait** : il faudrait aussi pouvoir modifier la catégorie, les note (tout)
- **Priorité** : haute 
- **Statut** : fait (E41d, 2026-11-03)

---

### R-2 — Tag manquant dans le formulaire de nouvelle transaction
- **Écran** : modal : Ajouter une transaction
- **Type** : amélioration/manque
- **Appareil** : les deux
- **Constat** : Le champs tags est manquant
- **Souhait** : Un champs texte pour y ajouter des tags (écrire un/des mots, puis appuyer sur entrer pour créer une "etiquette" avec une croix pour la retirer si besoin, pouvoir mettre plusieur tags)
- **Priorité** : moyen
- **Statut** : fait (E41c, 2026-11-03)

---

### R-3 — La page statistique n'est pas responsive au mobile
- **Écran** : /stats
- **Type** : bug
- **Appareil** : mobile
- **Constat** : La page statistique dépasse de l'écran vers la droite
- **Souhait** : voir la page en entiere sur tout l'écrant (sauf défillement vers le bas évidemment)
- **Priorité** : faible
- **Statut** : planifiée (E43)

---

### R-4 - Hotbar trop remplie (mobile)
- **Écran** : Tous
- **Type** : amélioration
- **Appareil** : mobile
- **Constat** : La hotbar sur moblie est trop remplie
- **Souhait** : il faudrait déplacer les notifications et l'icone de "my account" dans le menu déroulant en bas (histoire de séparé la navigation en haut, et mon compte et notification en bas)
à penser : il faidrait donc rajouté la petite icone rouge de notification AUSSI si le bouton de menu déroulant pour l'indiquer
SEULEMENT MOBILE
- **Priorité** : faible
- **Statut** : planifiée (E43)

---

### R-5 - Solde jour par jour -> Simulation
- **Écran** : /simulations
- **Type** : amélioration
- **Appareil** : les deux
- **Constat** : Lorsque qu'une simulation est calculé, dans les résultat, l'affichage du solde jour par jour se fait en claquant sur ce titre le faisant déroulé. mais il s'agit seulement du texte en gras
- **Souhait** : il faudrait rajouter une petite fleche vers le haut ou le bas (suivant l'état) pour indiquer qu'il est possible de cliquer afin de le faire déroulé
- **Priorité** : faible
- **Statut** : planifiée (E43)

---

<!-- Ajoutez les blocs suivants au-dessus de cette ligne, en copiant R-2. -->

## Consigne pour l'agent

1. Lire ce fichier en entier, puis `CLAUDE.md`, `SPEC.md` et `PLAN.md`.
2. Pour chaque remarque au statut « à faire » :
   - si c'est un bug, vérifier le comportement dans le code avant de conclure ;
   - si ça change le comportement attendu, proposer la mise à jour de `SPEC.md` (sans l'appliquer sans accord) ;
   - ajouter dans `PLAN.md` une ou plusieurs étapes, avec leur « Vérif », en respectant l'ordre et le format déjà utilisés dans ce fichier.
3. Ne pas coder à cette étape : seulement mettre à jour `PLAN.md`.
4. Lister à la fin : les remarques ajoutées au plan (avec leur numéro R-n), celles qui manquent d'informations (à demander à l'utilisateur), et celles qui sont déjà couvertes par une étape existante.
