# E43 — Inventaire des écrans (base des maquettes)

> Dérivé du code actuel d'`apps/web` (routes, gabarits) et de SPEC/PLAN. **Aucun style existant n'est conservé** : seul le contenu fonctionnel compte.
> Usage : une session neuve par écran. Coller (1) la section « Contexte commun », (2) la fiche de l'écran, (3) la « Consigne de maquette » en fin de fichier, puis noter ce qui plaît / déplaît / manque dans la zone « Retours » de la fiche.
> Contraintes permanentes : mobile-first, accessibilité AA (contrastes, focus visible, libellés de champ, navigation clavier), français, montants en € au format `1 234,56 €`, dates de jour sans heure.

## 0. Contexte commun

**Produit** : BudgeTracker, suivi de transactions (historique, statistiques, simulations). Pas de budget/plafond au sens classique. Public large (SaaS grand public), sobre, rassurant : on manipule de l'argent.
**Vocabulaire** : compte (3 types : *Normal*, *Non suivi* = portefeuille sans solde, *Avec intérêts*), transaction (dépense = DEBIT, revenu = CREDIT), virement (2 jambes liées), catégorie → sous-catégorie (facultatives), tag, récurrence, solde actuel / prévisionnel, solde de départ, scénario « et si », simulation de trésorerie, enveloppe dépensable, solde plancher.
**Sémantique visuelle à prévoir** : revenu (positif), dépense (négatif/solde négatif), alerte/erreur, information, succès, élément désactivé/archivé/masqué (barré aujourd'hui), « non lu », « bientôt supprimé ».
**Composants récurrents** (à concevoir une fois, réutilisés partout) :

| Composant | Où | Contenu / comportement |
|---|---|---|
| Bouton principal / secondaire / lien-bouton | partout | principal = action validante ; secondaire = modifier, supprimer, annuler ; lien-bouton = « Annuler », « Recharger », « Retirer… » |
| Champ de formulaire | partout | libellé, aide (« Ex. 12,34 »), erreur, état invalide, désactivé ; types : texte, montant (décimal), date, liste déroulante, case à cocher, boutons radio, zone de texte avec compteur, fichier, nombre |
| Carte / ligne de liste | comptes, récurrences, catégories, retours… | titre, métadonnées discrètes, actions en pied |
| Bandeau d'alerte | partout | 3 variantes : info/succès (`status`), erreur (`alert`), avec action (« Annuler », « Recharger ») |
| Bannière « Annuler » | après suppression (comptes, transactions, récurrences) | message « X supprimé » + action « Annuler » (restauration) |
| Tableau de données | stats, simulations, admin | en-têtes, colonnes numériques alignées à droite, défilement horizontal sur mobile |
| Graphique de courbes | simulations | légende, grille, ligne du zéro, infobulle au survol/clavier, tableau textuel équivalent |
| Barres de proportion | stats | 2 barres (revenus/dépenses) sous chaque libellé |
| Pastille de compteur | cloche | nombre de non lues, « 99+ » |
| Formulaire repliable | saisie de transaction | « Plus de détails (facultatif) » |
| Zone de confirmation inline | suppression de catégorie, de compte (RGPD) | texte d'avertissement + confirmer / annuler |
| Pièce jointe | historique | état vide (champ fichier) / état rempli (nom, taille, Ouvrir, Retirer) / erreur |
| Messages d'état lecteur d'écran | pages admin, catégories | invisibles, annoncés |

**Pas de modale aujourd'hui** : tout est en ligne dans la page. La refonte prévoit des modales (candidats : saisie de transaction, virement, édition d'un compte, suppression avec confirmation) et des menus déroulants (navigation, compte utilisateur).

---

## 1. Coquille d'application (présente sur toutes les pages)

**Visible**
- Lien d'évitement « Aller au contenu » (visible au focus).
- En-tête : logo/nom « BudgeTracker » (lien vers `/`), navigation principale, cloche de notifications (+ pastille), bouton « + Transaction », « Se déconnecter » (nom de l'utilisateur annoncé aux lecteurs d'écran).
- Navigation (connecté) : Tableau de bord, Comptes, Historique, Récurrences, Catégories, Statistiques, Simulations, Mon compte, Donner mon avis, + **Administration** (admins seulement). 9 à 10 entrées : trop pour une barre mobile → prévoir regroupement (barre du bas avec 4-5 entrées + menu « Plus », ou menu déroulant).
- Non connecté : seulement logo, pas de navigation.
- Pied de page : Mentions légales, Confidentialité, CGU.
- Zone principale `main` (cible du lien d'évitement).

**Interactif** : lien actif marqué (`aria-current`), cloche → `/notifications`, « + Transaction » → saisie rapide (candidat modale), déconnexion → `/login`.
**Responsive** : barre de nav en bas sur mobile, dans l'en-tête dès 768 px (comportement actuel, à conserver ou remplacer).
**Questions pour la maquette** : où range-t-on Mon compte / Avis / Déconnexion (menu avatar) ? logo ? thème clair/sombre ? mode compact ?

---

## 2. Écrans publics (non connecté)

### 2.1 Connexion — `/login`
- Visible : titre, erreur (échec Google : 3 messages possibles ; identifiants), champ e-mail, champ mot de passe, « Se connecter », lien « Mot de passe oublié ? », séparateur « ou », « Continuer avec Google », lien « Créer un compte ».
- États : erreur de champ (e-mail invalide, mot de passe vide), envoi en cours (bouton désactivé), erreur serveur (429 verrouillage, 401, 403 e-mail non vérifié).
- Idées à explorer : illustration/ton d'accueil, argument produit court, afficher/masquer le mot de passe.
- **Retours** (2026-10-15)
  - Direction retenue : charte « Encre de chéquier », ton un peu plus accueillant (formulaire dans une carte centrée, accroche sous le titre).
  - À ajouter : animations de la charte (entrée de page `enter-up`, bandeau d'erreur `enter-down`) ; phrase d'accroche « Suivez vos dépenses et vos revenus, simplement. ».
  - À retirer : rien.
  - Proposé, non codé : afficher/masquer le mot de passe (demande du code TS), illustration.

### 2.2 Création de compte — `/signup`
- Visible : e-mail, nom, mot de passe (aide « 10 caractères minimum »), case CGU + confidentialité (liens ouvrant un nouvel onglet), « Créer mon compte », « S'inscrire avec Google » (exige la case cochée), lien « Se connecter ».
- État succès : message « Vérifiez votre boîte de réception… expire dans 24 h » + lien vers la connexion (le formulaire disparaît).
- Erreurs : champ par champ, CGU non cochées, e-mail déjà utilisé (message neutre côté serveur).
- Idées : indicateur de robustesse du mot de passe, étapes.
- **Retours** (2026-10-15)
  - Direction retenue : identique à la connexion (§2.1) : carte centrée, accroche sous le titre, boutons pleine largeur, « ou » entre deux filets, « Déjà un compte ? » sous la carte.
  - À ajouter : animations de la charte (entrée de page `enter-up`, bandeaux `enter-down`) ; accroche « Quelques secondes suffisent pour commencer. » (masquée après envoi) ; sur bureau, nom et mot de passe côte à côte et espacements resserrés pour tenir sans défilement en 1366×768, comme la connexion.
  - À retirer : rien.
  - Proposé, non codé : indicateur de robustesse du mot de passe, afficher/masquer le mot de passe (demandent du code TS).

### 2.3 Vérification d'e-mail — `/verify-email?token=…`
- 3 états : en cours (« Vérification en cours… »), succès (message + bouton « Se connecter »), erreur (lien invalide/expiré/incomplet + « Recommencer l'inscription »).
- Idées : animation de validation, icône d'état.

### 2.4 Mot de passe oublié — `/forgot-password`
- Visible : e-mail, « Envoyer le lien », message neutre après envoi (expire 30 min), lien « Retour à la connexion ».

### 2.5 Nouveau mot de passe — `/reset-password?token=…`
- États : formulaire (nouveau mot de passe, aide 10 caractères), succès (« autres sessions déconnectées » + bouton), lien incomplet, lien invalide/expiré (+ lien « Demander un nouveau lien »).

### 2.6 Pages légales — `/mentions-legales`, `/confidentialite`, `/cgu`
- Pages de texte long (articles à titres h2) : éditeur, hébergeur, propriété intellectuelle, données collectées, durées de conservation, droits, cookies, CGU. Contenu éditeur encore à compléter (`[À compléter…]`).
- Visible : titre, date de mise à jour, sommaire éventuel, liens croisés entre les trois pages.
- Idées : lisibilité (largeur de ligne, hiérarchie), sommaire ancré, bouton « imprimer ».

### 2.7 Page introuvable — `**`
- Titre, phrase, un lien : « Retour au tableau de bord » (connecté) ou « Se connecter » (non connecté).
- Idées : illustration, ton léger.

---

## 3. Écrans connectés — cœur

### 3.1 Tableau de bord — `/` (**contenu non défini : étape E42 bloquée**)
- Aujourd'hui : simple page « arrive bientôt ». Le tableau de bord n'est pas spécifié (SPEC §7).
- **À décrire par toi avant maquette** : indicateurs voulus (solde total ? soldes par compte ? dépenses du mois ? enveloppe restante ? dernières transactions ? alertes taux manquant ?), comptes concernés, actions rapides.
- Données disponibles pour le nourrir : soldes actuel/prévisionnel par compte, stats par mois/catégorie, dernières transactions, enveloppe de la simulation sauvegardée, notifications non lues, récurrences à venir.
- Proposition de départ pour la maquette (à valider) : carte « solde total », liste des comptes avec solde, dépenses du mois vs mois précédent, 5 dernières transactions, bouton d'ajout rapide.

### 3.2 Mes comptes — `/accounts`
- Visible :
  - Bannière « Compte X supprimé. Annuler ».
  - Erreur (+ « Recharger » si conflit de version 409).
  - Liste de cartes de compte : nom, type (Normal / Non suivi / Avec intérêts), **solde actuel** (rouge si négatif), **solde prévisionnel** (si différent), pour les comptes à intérêts : taux en vigueur + date d'effet **ou alerte « taux manquant »**, boutons Modifier / Supprimer. Compte « Non suivi » : aucun solde.
  - Lien « Faire un virement entre comptes ».
  - Formulaire Nouveau / Modifier un compte : nom, type de suivi, solde de départ (facultatif, signé, ex. `-50`), date du solde de départ ; boutons Créer/Enregistrer et « Annuler la modification ». Les deux champs de solde disparaissent pour un compte « Non suivi » ou en édition.
  - Formulaire « Taux d'intérêt » (seulement s'il existe un compte à intérêts) : compte, taux annuel en %, date d'effet, « Enregistrer le taux ».
  - État vide : « Aucun compte pour l'instant ».
- Interactions : modifier = remplit le formulaire et donne le focus ; supprimer = suppression logique avec annulation ; soldes chargés un par un (chargement progressif visible).
- Candidats modale : création/édition de compte, taux d'intérêt. Idées : icône/couleur par compte, carte « total », graphique de tendance par compte.

### 3.3 Ajouter une transaction — `/transactions/new`
- Principe : **saisie en 3 champs** (montant, catégorie, compte), date = aujourd'hui, le reste replié.
- Visible : titre, lien « Faire un virement entre comptes », erreur, montant (aide « Montant positif, ex. 12,34 »), catégorie (facultatif, « Sans catégorie »), sous-catégorie (apparaît seulement si la catégorie en a), compte (présélectionné s'il n'y en a qu'un ; message « Aucun compte : créez-en un »), bloc repliable « Plus de détails » (Sens Dépense/Revenu, Date, Libellé, Notes), « Enregistrer ».
- Cas particuliers à prévoir :
  - Date antérieure au solde de départ du compte : note « visible dans l'historique et les stats, sans changer le solde ».
  - Date = jour du solde de départ : question obligatoire « Compter dans le solde ? » (radio Oui/Non + explication).
  - Compte « Non suivi » : seules les dépenses sont acceptées (erreur sinon).
- Après succès : retour à `/accounts`.
- Candidat : bottom-sheet/modale ouverte depuis « + Transaction ». Idées : clavier numérique, catégories en pastilles/icônes, sélecteur Dépense/Revenu bien visible, animation de confirmation.

### 3.4 Nouveau virement — `/transfers/new`
- Visible : compte débité (comptes suivis uniquement), compte crédité (tous), message d'explication si cible = portefeuille non suivi (compte comme dépense « Espèces », double comptage assumé), montant, date, question « Compter dans le solde ? » (si jour du solde de départ d'un des deux comptes) / note « antérieure au solde de départ », libellé facultatif, « Virer », lien « Retour aux comptes ».
- Erreurs : mêmes comptes, compte inexistant, source non suivie.
- Idées : visuel source → cible (flèche), échange des deux comptes en un geste.

### 3.5 Historique — `/history`
- Visible :
  - Bannière « Transaction X supprimée. Annuler ».
  - Erreur (+ « Recharger » sur conflit).
  - Filtres : Du, Au, Compte, Catégorie (inclut « Sans catégorie », options « Parent › Enfant »), Tag ; boutons Filtrer / Effacer les filtres.
  - Liste : par ligne date, libellé (ou catégorie, ou « Transaction »), compte · catégorie · « Virement » si jambe de virement, **montant** (+ vert revenu / rouge dépense), actions Modifier (absent pour un virement) / Supprimer, contrôle de pièce jointe.
  - Édition en ligne dans la ligne : montant, libellé, date, question « Compter dans le solde ? » si déplacée au jour du solde de départ ; Enregistrer / Annuler.
  - « Charger plus » (pagination par curseur, 50 par page) ; état vide avec lien « Ajouter une transaction ».
- Pièce jointe (par transaction) : sans pièce → champ fichier (JPEG/PNG/WebP/PDF, 5 Mo max) ; avec pièce → « Justificatif : nom (N Ko) », Ouvrir (nouvel onglet), Retirer ; erreurs (taille, format, quota plein, déjà une pièce).
- Idées : regroupement par jour avec sous-total, icône de catégorie, filtres repliables sur mobile (puces de filtres actifs), recherche texte, swipe pour supprimer, miniature de justificatif.
- Note : les virements ne s'éditent pas ici (une seule version pour les deux jambes) ; suppression d'une jambe supprime les deux.

### 3.6 Récurrences — `/recurrences`
- Visible : bannière d'annulation, erreur, liste (libellé, sens et montant « +/− », « tous les N unité depuis le JJ », fin éventuelle, compte, bouton Supprimer), état vide, formulaire « Nouvelle récurrence » : montant, catégorie, sous-catégorie, compte, sens, « Tous les » (nombre) + unité (jour/semaine/mois/année), première échéance, dernière échéance (facultatif), libellé, « Créer la récurrence ».
- Particularités : pas d'édition (création/suppression seulement) ; les occurrences sont créées par le serveur et apparaissent dans l'historique.
- Idées : prochaine échéance affichée, calendrier/frise des prochains prélèvements, regroupement revenus vs dépenses, total mensuel récurrent.

### 3.7 Mes catégories — `/categories`
- Visible :
  - Explication (masquer/renommer une globale ne concerne que soi).
  - Arbre à 2 niveaux : chaque nœud = nom, origine « globale / personnelle », « d'origine "X" » si renommée, « masquée » (barré), « archivée » ; actions : Renommer (formulaire en ligne), Masquer/Afficher + « Nom d'origine » (globales), Supprimer (personnelles) ; suppression = formulaire de **réaffectation** des transactions vers une autre catégorie (obligatoire si utilisée).
  - Formulaire « Nouvelle catégorie » : nom, catégorie parente (facultatif), case « Proposer cette catégorie à tous » (désactivée sous une catégorie personnelle, avec explication).
  - « Mes suggestions » : nom, parent, statut (En attente / Acceptée / Refusée / Traitée).
- Idées : pastille couleur/icône par catégorie, repli des sous-catégories, interrupteur de masquage, modale de suppression/réaffectation.

### 3.8 Statistiques — `/stats`
- Visible : filtres (Du, Au, Compte, bouton Afficher), note (virements et soldes de départ exclus ; espèces = dépense ; double comptage assumé), **3 sections** : Évolution mensuelle (mois en toutes lettres), Par catégorie (« Parent › Enfant », ligne « Sans catégorie »), Par tag. Chaque section = tableau Libellé / Revenus / Dépenses avec deux barres proportionnelles sous le libellé (échelle commune par section) ; état « Aucune donnée sur cette période ».
- Idées (forte marge de refonte) : vrais graphiques (courbe/histogramme mensuel, donut ou barres par catégorie), cartes de synthèse (total revenus, dépenses, solde net, moyenne), comparaison avec la période précédente, filtres rapides (ce mois, 3 mois, année), clic sur une catégorie → historique filtré, animation d'apparition. Toujours garder un équivalent tableau accessible.

### 3.9 Simulations (scénarios « et si ») — `/simulations`
- Visible : explication (copie virtuelle, données jamais modifiées), lien vers la simulation de trésorerie, erreur ;
  - « Mes scénarios » : cartes avec case à cocher de comparaison (1 à N max), nom, liste des modifications décrites, Modifier / Supprimer ;
  - « Comparer » : compte, horizon en mois, bouton Comparer ; **graphique de courbes** (base « Sans changement » grise + 1 courbe par scénario, légende, infobulle survol/clavier) ; **tableau** Date × (sans changement + scénarios) ;
  - Formulaire scénario : nom ; 1 à N « modifications », chacune de type *Dépenser plus/moins dans une catégorie* (catégorie, sens, montant/mois), *Nouvel abonnement* (montant/mois), *Achat à crédit* (montant emprunté, taux %, durée en mois) ; ajouter/retirer une modification ; Enregistrer / Annuler.
- Idées : cartes-gabarits de scénario, curseurs, résultat chiffré (écart final vs base) en gros, comparaison visuelle claire.

### 3.10 Simulation de trésorerie — `/simulations/tresorerie`
- Visible :
  - Titre + explication + lien « Scénarios et si ».
  - « Mes simulations » : cartes (nom, du…au…, Ouvrir / Supprimer), vide.
  - Formulaire « Nouvelle simulation / Simulation X » : comptes (cases), date de début (aujourd'hui au plus tôt), date de fin (jour X), **récurrences enregistrées cochables/décochables** (libellé, sens, montant, fréquence), **récurrences simulées** (0..N : libellé, sens, montant, tous les N unité, première/dernière échéance, Retirer), **ponctuels simulés** (0..N : libellé, sens, montant, date, Retirer), **solde plancher** facultatif (ex. 200, négatif possible) + enveloppe « par mois / par semaine », bouton **Calculer**, nom de la simulation, Enregistrer / Nouvelle simulation.
  - **Résultat** (zone annoncée aux lecteurs d'écran) : « Solde au JJ/MM : X € » (valeur phare), départ, revenus, dépenses ; alerte « sous le plancher » ; bloc enveloppe (enveloppe de la période, déjà dépensé, **reste à dépenser**, « période i sur n ») ; courbe du solde projeté ; « Solde jour par jour » (repliable, tableau) ; tableau « Détail de la période » (libellé, origine : Récurrence / Récurrence simulée / Ponctuelle simulée / Transaction prévue, occurrences, total ; lignes décochées grisées).
- Idées : page en 2 colonnes (paramètres / résultat live), jauge de l'enveloppe restante, grand chiffre du solde au jour X, assistant en étapes, ajout de ponctuel via modale.

### 3.11 Mon compte — `/me`
- Visible : nom — e-mail ; section **Exporter mes données** (explication, boutons JSON et CSV) ; section **Supprimer mon compte** (avertissement définitif, saisie du mot `SUPPRIMER`, bouton actif seulement quand le mot est exact).
- Idées : zone « danger » nettement distincte, modale de confirmation, avatar/initiales, résumé du compte (date d'inscription, stockage utilisé).

### 3.12 Donner mon avis — `/feedback`
- Visible : explication (lu par l'admin, ni mot de passe ni donnée bancaire, durée de conservation), type (Avis / Idée de fonctionnalité / Problème), message (zone de texte, compteur `n / max`), Envoyer ; confirmation annoncée ; liste « Mes retours » (type · date/heure · statut Nouveau/Traité, message en texte brut), vide.
- Limites : 5 par 24 h, 20 non traités (erreurs correspondantes).
- Idées : sélecteur de type en puces avec icônes, confirmation animée.

### 3.13 Notifications — `/notifications` + cloche
- Cloche (en-tête) : icône, pastille du nombre de non lues (« 99+ »), libellé accessible « Notifications (N non lues) » ; rafraîchie à chaque navigation.
- Page : liste, non lues d'abord ; carte = nature (annonce / notification), date/heure, « Non lue », message en texte brut, bouton « Marquer comme lue » ; vide.
- Idées : panneau déroulant depuis la cloche (aperçu des dernières) en plus de la page, « Tout marquer comme lu », distinction visuelle annonce vs message personnel.

---

## 4. Écrans d'administration (rôle ADMIN, jamais de donnée financière d'un utilisateur)

### 4.1 Administration — `/admin`
- Visible : navigation vers 4 sous-pages (Catégories globales, Retours utilisateurs, Notifications et annonces, Suggestions de catégorie) ; bouton Actualiser ; 3 blocs de statistiques en listes de définitions :
  - Utilisateurs : total, e-mail vérifié, nouveaux 7 j / 30 j, actifs 7 j / 30 j.
  - Volumes : comptes, transactions, récurrences, pièces jointes (+ taille), taille de la base.
  - État de l'API : en service depuis (durée + date), latence de la base, mémoire, erreurs serveur depuis le démarrage, dernière exécution de 3 tâches (récurrences, intérêts, purge) ; mention « compteurs remis à zéro au redémarrage ».
- Idées : tableau de bord d'exploitation (cartes chiffrées, pastilles de santé vert/orange/rouge, sparkline), badges de compteur sur les sous-pages (retours non traités, suggestions en attente).

### 4.2 Catégories globales — `/admin/categories`
- Visible : lien « ← Administration », explication Archiver vs Supprimer, arbre à 2 niveaux, par nœud : nom (+ « archivée », barré), Renommer (en ligne), Archiver/Restaurer, Supprimer (seulement pour celles créées ici, avec zone de confirmation « pour tous les utilisateurs ? ») ; formulaire « Nouvelle catégorie globale » (nom, catégorie parente) ; message d'erreur « nom en double ».

### 4.3 Retours utilisateurs — `/admin/feedback`
- Visible : durées de conservation, bandeau « N retour(s) non traité(s) supprimés d'ici X jours », filtres (type, statut, tri par date/type/statut), liste : type · date · statut, message (texte brut, retours à la ligne conservés), date de suppression prévue (« Bientôt supprimé » en évidence), bouton « Marquer comme traité » ; vide. Ni auteur ni e-mail.

### 4.4 Notifications et annonces — `/admin/notifications`
- Visible : bandeau RGPD (une annonce ne remplace pas l'e-mail) ; formulaire **Annonce à tous** : case « Modification des CGU » (préremplit le message, révèle « Entrée en vigueur » avec préavis de 30 jours et avertissement si plus court), message avec compteur, « Envoyer à tous » ; formulaire **Notification à un utilisateur** : e-mail du destinataire, message, Envoyer ; confirmations annoncées.

### 4.5 Suggestions de catégorie — `/admin/suggestions`
- Visible : explication, filtre de statut, liste : nom (+ « dans X »), date, statut ; pour une suggestion en attente 3 actions (Accepter / Refuser / Marquer comme traitée) ouvrant un formulaire : case « Répondre à l'auteur par une notification », réponse **préremplie et modifiable** selon la décision, « Confirmer : … » / Annuler ; vide. Ni auteur ni e-mail.

---

## 5. Récapitulatif des routes

| Route | Écran | Accès |
|---|---|---|
| `/login` `/signup` `/verify-email` `/forgot-password` `/reset-password` | 2.1 à 2.5 | public |
| `/mentions-legales` `/confidentialite` `/cgu` | 2.6 | public |
| `**` | 2.7 | tous |
| `/` | 3.1 (à définir) | connecté |
| `/accounts` `/transactions/new` `/transfers/new` | 3.2 à 3.4 | connecté |
| `/history` `/recurrences` `/categories` `/stats` | 3.5 à 3.8 | connecté |
| `/simulations` `/simulations/tresorerie` | 3.9, 3.10 | connecté |
| `/me` `/feedback` `/notifications` | 3.11 à 3.13 | connecté |
| `/admin` `/admin/categories` `/admin/feedback` `/admin/notifications` `/admin/suggestions` | 4.1 à 4.5 | ADMIN |

Total : 25 écrans + coquille + 12 composants réutilisables. Ordre de maquette conseillé : coquille + composants → connexion/inscription → comptes → saisie de transaction → historique → statistiques → simulation de trésorerie → le reste → admin. Le tableau de bord se fait après description (E42).

---

## 6. Consigne de maquette (à coller en fin de prompt)

> Génère une première maquette de l'écran « … » de BudgeTracker, d'abord en version mobile (360 px) puis bureau (1280 px). Respecte la liste du visible/interactif ci-dessus, sans rien retirer ; tu peux proposer des ajouts, signalés comme tels. Donne : palette (avec contrastes AA), typographie, hiérarchie, états (vide, chargement, erreur, succès), composants réutilisables utilisés, et ce que tu proposes en animation. Propose 2 directions différentes. Reste sobre et rassurant : il s'agit d'argent.

## 7. Zone de retours (à remplir par écran après chaque maquette)

Pour chaque écran : **J'aime** / **Je n'aime pas** / **À ajouter** (contenu, animation, image) / **À retirer** / Direction retenue.
Charte globale à fixer en premier (étape suivante d'E43) : couleurs, typographie, espacements, rayons, ombres, iconographie, mouvements, thème sombre ou non.
