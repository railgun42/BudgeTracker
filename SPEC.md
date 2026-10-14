# BudgeTracker — Spécification

> Statut : v1 validée par interview. Tous les choix sont tranchés ; seules deux valeurs par défaut (§12) restent modifiables.
> Révision après essai local (PLAN phases 8 à 10) : solde de départ (§3.3), catégories facultatives à deux niveaux (§3.2), simulation de trésorerie avec plafond (§6), notifications (§7), administration et communication (§13). Le tableau de bord (§7) reste à décrire.

## 1. Objectif

Application web de suivi de transactions : **historique**, **statistiques**, **simulations**. Ouverte au public (SaaS, inscription libre). Pas de notion de budget/plafond : le mot « budget » désigne le suivi, pas des limites.

**Hors v1 (explicitement)** : agrégation bancaire / import CSV-OFX, plafonds et alertes, multi-devises, mode hors ligne / PWA, 2FA, chiffrement de bout en bout, abonnement payant, environnement de staging.

## 2. Stack et hébergement

| Couche | Choix | Remarque |
|---|---|---|
| Front | Angular (existant, `apps/web`) | Mobile-first |
| API | **NestJS** (TypeScript) | Types du domaine partageables avec Angular |
| BDD | PostgreSQL | |
| ORM / migrations | Prisma (`$queryRaw` pour les agrégats de stats) | Migrations versionnées obligatoires |
| Scheduler | `@nestjs/schedule` | Récurrences + intérêts |
| Fichiers | OVH Object Storage (S3) | URLs signées |
| Email | SMTP OVH ou Brevo/Resend | Vérification, reset |
| Hébergement | VPS OVH 2–4 Go, Docker Compose, Caddy (TLS Let's Encrypt) | |

Monorepo : `apps/web`, `apps/api`, package `shared` pour les types/enums du domaine.

## 3. Modèle de domaine

### 3.1 Règles transverses
- **Montants** : entiers en **centimes** (`BIGINT`), jamais de `float`. Devise **EUR** figée ; colonne `currency` présente mais non exploitée.
- **Dates** : une transaction porte une **date de jour** (`LocalDate`, sans heure ni fuseau). Les horodatages techniques (`createdAt`…) sont en UTC.
- **Isolation** : toute table métier porte `userId`, et chaque requête filtre dessus (test automatisé obligatoire sur chaque endpoint). Les routes d'administration (§13) font exception côté accès, jamais côté confidentialité : elles ne servent que des agrégats et les messages adressés à l'administrateur, jamais les transactions d'un utilisateur.
- **Concurrence** : colonne `version` sur les entités modifiables ; une écriture sur une version périmée renvoie **409** et l'UI propose de recharger.
- **Suppression logique** : `deletedAt` sur transactions, comptes, récurrences. Annulation possible depuis l'UI. Purge définitive après **30 jours** et immédiate lors de la suppression du compte utilisateur. Toutes les requêtes filtrent `deletedAt IS NULL`.

### 3.2 Entités
- **User** : id, email (unique, vérifié), nom, `lastConnection`, `role` (`USER` | `ADMIN`, jamais modifiable par l'API HTTP), consentement aux CGU (`termsAcceptedAt`, `termsVersion`). Le champ `phoneNumber` est **supprimé** (minimisation RGPD). Aucune donnée d'authentification dans le modèle partagé.
- **Credentials** (API uniquement) : hash Argon2id, jamais exposé. Plus lien OAuth Google (`provider`, `providerId`).
- **Account** : name, `trackingType`, userId. **Pas de champ solde** : calculé.
- **TrackingType**
  - `NORMAL` : solde = somme des transactions (CREDIT +, DEBIT −).
  - `NOT_TRACKED` : portefeuille. Pas de solde ni d'entrées ; sert à l'historique et aux statistiques (dépenses seulement).
  - `WITH_INTEREST` : comme NORMAL, avec crédit d'intérêts automatique (voir 3.5).
- **Transaction** : id (UUID), accountId, name, date, `amountCents` (> 0), type (`DEBIT` | `CREDIT` | `TRANSFER` via `transferId`), details, categoryId (**facultatif**), tags, 0..1 pièce jointe, `recurrenceId` (nullable), `version`, `deletedAt`.
- **Category** : 2 niveaux max, utilisés comme **catégorie générale puis sous-catégorie précise** (ex. Sport → abonnement, licence, séance), saisies dans deux champs distincts et **toutes deux facultatives** : une transaction peut n'avoir aucune catégorie. **Catégories globales** (visibles de tous, non modifiables par les utilisateurs, créées par le seed ou par l'administrateur, §13) + **catégories personnelles** de l'utilisateur (nouvelles catégories, ou sous-catégories ajoutées sous une catégorie globale). Un utilisateur peut **masquer** une catégorie globale et la **renommer pour lui seul** sans toucher aux autres utilisateurs (`UserCategoryPreference`). Une catégorie utilisée ne se supprime pas en cascade : les perso se **réaffectent** puis se suppriment, les globales ne se suppriment pas côté utilisateur. Les catégories techniques (Intérêts, Espèces, Solde de départ, Virement) ne sont pas proposées à la saisie.
- **Tag** : libre, transverse, par utilisateur.
- **Recurrence** + **TransactionTemplate** : `interval` + `unit` (DAY/WEEK/MONTH/YEAR), startDate, endDate nullable, lastGeneration.
- **Scenario** / **Simulation sauvegardée** : userId, nom, paramètres JSON (voir §6).
- **Feedback**, **CategorySuggestion**, **Announcement**, **Notification** : voir §13.
- **InterestRate** : accountId, taux annuel, date d'effet (historique de taux).

### 3.3 Solde
`SUM` SQL indexé sur `(accountId, date)`. Jamais en chargeant toutes les transactions. Une transaction antidatée recalcule naturellement le solde. Les transactions futures sont incluses dans « solde prévisionnel », pas dans « solde actuel ».

**Solde de départ.** À la création d'un compte, l'utilisateur saisit son solde actuel (transaction « Solde de départ » datée). Il peut ensuite recopier l'historique de sa banque pour alimenter les statistiques : toute transaction **antérieure** à la date du solde de départ est conservée (historique, statistiques) mais **n'entre ni dans le solde actuel ni dans le solde prévisionnel**, car elle est déjà comprise dans le solde saisi. À la **même date** que le solde de départ, l'utilisateur choisit explicitement si la transaction est comptée ou non (l'API refuse la saisie sans ce choix). La règle est évaluée à la lecture, à partir du solde de départ le plus récent du compte : modifier sa date déplace la frontière, le supprimer fait tout compter, le restaurer la rétablit ; une transaction déjà présente à la nouvelle date sans choix explicite est comptée. Le choix n'est redemandé que si la transaction est déplacée sur ce jour (date ou compte). Virements : même règle, **jambe par jambe** (chaque jambe suit le solde de départ de son compte, un seul choix pour les deux). Les intérêts (§3.5) suivent la même règle.

### 3.4 Virements
Un virement est **une opération, deux transactions** jumelées par `transferId` (DEBIT sur la source, CREDIT sur la cible).
- Exclus des statistiques revenus/dépenses.
- Modifier ou supprimer une jambe applique l'opération aux deux (une seule version, un seul verrou).
- Vers un compte `NOT_TRACKED` (ex. retrait d'espèces) : seule la jambe source existe et le virement **compte comme une dépense** pour les stats (catégorie système « Espèces »). Les achats saisis ensuite dans le portefeuille s'y ajoutent : double comptage assumé, à expliquer dans l'UI.

### 3.5 Comptes avec intérêts
- Taux annuel saisi par l'utilisateur, historisé avec date d'effet.
- Calcul sur le modèle Livret A : par quinzaine sur le solde minimum de la quinzaine, taux/24.
- Une transaction CREDIT catégorie « Intérêts » est générée le **31/12**, de façon idempotente. Si le taux n'est pas renseigné, rien n'est généré et l'UI le signale.

### 3.6 Récurrences
- Génération **côté serveur** : job quotidien + rattrapage à la connexion (utilisateur absent un mois ⇒ toutes les occurrences dues sont créées).
- **Idempotence** : contrainte unique `(recurrenceId, occurrenceDate)`.
- Cas du 29/30/31 : une récurrence mensuelle démarrée le 31 tombe sur le **dernier jour** des mois courts, sans dérive (le jour d'ancrage reste 31).
- **Modification du montant/template : futur seulement.** Le passé n'est jamais réécrit. Une occurrence peut être éditée ou supprimée individuellement sans casser la règle. Supprimer une occurrence passée ne la régénère pas.
- Le front ne génère plus rien (`autoUpdateTransaction` est supprimé).

## 4. Pièces jointes
- **Une pièce par transaction**, images (JPEG/PNG/WebP) et PDF, **5 Mo max**.
- Type vérifié côté serveur par signature de fichier, pas seulement par extension. Nom de fichier jamais utilisé comme chemin.
- Stockage S3 OVH, accès par URL signée de courte durée, jamais publique.
- **Quota par utilisateur** (200 Mo) pour limiter l'abus.
- Offre payante à quota élevé : **non implémentée**, mais le quota est une valeur par utilisateur (pas une constante) pour l'autoriser plus tard.
- Supprimées avec la transaction (après purge) et avec le compte.

## 5. Authentification et sécurité
- Email + mot de passe (**Argon2id**) et **connexion Google (OAuth)**. Liaison de comptes par email vérifié uniquement.
- **Vérification d'email** obligatoire à l'inscription ; **reset de mot de passe** par lien à usage unique et expiration courte.
- Session : **cookie httpOnly, Secure, SameSite** + token de rafraîchissement **rotatif** ; protection **CSRF**. Aucun token en `localStorage`.
- **Rate limiting** par IP et par compte sur login, inscription, reset ; verrouillage progressif.
- Validation stricte de toutes les entrées (DTO + schéma), requêtes paramétrées, en-têtes de sécurité (CSP, HSTS), CORS restreint.
- Données au repos : volume chiffré, sauvegardes chiffrées, BDD non exposée publiquement. Les stats restent en SQL. (Limite assumée : l'administrateur peut techniquement lire les données ; à écrire dans la politique de confidentialité.)
- Logs structurés **sans donnée financière ni email en clair**.
- Secrets hors dépôt (variables d'environnement).
- **Administration** (§13) : rôle `ADMIN` attribué uniquement hors API HTTP (script d'exploitation), routes `/admin/*` protégées par garde de rôle (401 anonyme, 403 non-admin), actions d'administration journalisées (sans donnée financière).

## 6. Statistiques et simulations

### Statistiques
Répartition par catégorie/tag, évolution mensuelle revenus/dépenses, par compte ou global. Les `TRANSFER` sont exclus. Calcul en SQL agrégé.

### Simulations (calcul serveur)
Fonctions **pures**, testées unitairement, indépendantes de la BDD :
1. **Projection du solde** : solde actuel + récurrences futures + rythme moyen de dépenses non récurrentes (fenêtre configurable).
2. **Simulation de trésorerie** : « combien me restera-t-il au jour X ». Entre une date de début (aujourd'hui par défaut, modifiable) et une date de fin, le solde projeté et le détail des dépenses de la période, à partir des récurrences enregistrées (**cochables/décochables** pour la simulation), de récurrences supplémentaires et de dépenses ou revenus ponctuels anticipés propres à la simulation. Rien n'est écrit dans les vraies données. L'utilisateur peut fixer un **solde plancher** : l'application en déduit le montant dépensable par mois ou par semaine sans passer sous ce plancher. La simulation est **sauvegardable** et suivie dans le temps : les dépenses réelles de la période sont déduites de l'enveloppe en cours, et le reliquat d'une période écoulée est réparti sur les périodes restantes (ex. 100 €/mois, 50 € dépensés le premier mois ⇒ 125 €/mois sur les deux suivants).
3. **Scénarios « et si »** (cohabitation ou remplacement par la simulation de trésorerie à arbitrer, PLAN E33) : un `Scenario` sauvegardé = paramètres JSON (ex. −100 €/mois sur une catégorie, nouvel abonnement, achat à crédit) appliqués à une **copie virtuelle** du compte ; les vraies données ne sont jamais modifiées. Comparaison de scénarios côte à côte.
4. **Objectifs d'épargne** : « X € dans N mois » ⇒ effort mensuel requis et progression.
5. **Calculateurs crédit / placement** : mensualités, coût total, intérêts composés, inflation. Aucun accès aux transactions.

## 7. UX
- **Mobile-first**, responsive, en ligne uniquement. Saisie d'une dépense en **3 champs** (montant, catégorie, compte) avec date par défaut = aujourd'hui, détails optionnels.
- Historique paginé par curseur (50 par page), filtres date/catégorie/tag/compte.
- Annulation d'une suppression (bannière « Annuler »), message clair sur un conflit 409.
- Catégorie et sous-catégorie : deux champs liés et facultatifs ; l'historique peut filtrer les transactions sans catégorie.
- **Notifications** : cloche dans la barre de navigation avec le nombre de nouvelles notifications (§13).
- **Page 404** : le libellé du bouton de retour correspond à la page réellement atteinte (connecté ou non).
- **Tableau de bord** : prévu, contenu **à décrire** par le propriétaire du produit avant spécification.
- **Style** : refonte complète (couleurs, disposition, police, images, modales, menus) en dernière étape, une fois les fonctionnalités terminées.
- Comptes `NOT_TRACKED` : aucun solde affiché.
- Accessibilité de base : contrastes, navigation clavier, libellés de formulaire.

## 8. RGPD et légal
- **Suppression de compte réelle** : efface utilisateur, transactions, fichiers ; les sauvegardes expirent sous un délai documenté (ex. 30 jours).
- **Export** de toutes les données de l'utilisateur en JSON et CSV.
- Pages **mentions légales, politique de confidentialité, CGU** (hébergeur OVH, contact, finalités, durées de conservation) avant l'ouverture publique.
- Minimisation : `phoneNumber` supprimé ; seules les données utiles sont collectées.

## 9. Exploitation
- **Sauvegardes PostgreSQL** : dump chiffré quotidien vers OVH Object Storage, **restauration testée** avant l'ouverture publique, puis périodiquement.
- **CI** GitHub Actions : lint, tests, build des images Docker. Déploiement manuel (SSH + `docker compose pull`).
- **Supervision minimale** : test de disponibilité externe, alerte disque/erreurs, logs sans données sensibles.
- Pas de staging en v1 ; les migrations se testent localement sur une copie de base avant la prod.

## 10. Tests (critères d'acceptation)
- Unitaires sur : génération de récurrences (31 du mois, rattrapage, idempotence), calcul d'intérêts, virements, projections/scénarios, calculateurs.
- Intégration : isolation entre utilisateurs sur chaque endpoint, conflit 409, suppression/restauration/purge, quotas de fichiers.
- Critère clé : deux requêtes simultanées de génération de récurrence ne créent jamais de doublon.
- Solde : une transaction antérieure au solde de départ ne modifie pas le solde mais apparaît dans l'historique et les statistiques.
- Administration : toute route `/admin/*` répond 401 sans session et 403 à un utilisateur non admin ; aucun agrégat ni message ne révèle les transactions d'un utilisateur.
- Notifications : un utilisateur ne lit et ne marque comme lues que ses propres notifications.

## 11. Découpage proposé
1. API : auth, utilisateurs, comptes, catégories, transactions (+ virements, verrou, soft delete), solde.
2. **Audit du front existant** (`apps/web`) : vérifier ce qui est réutilisable, refaire ce qui ne l'est pas et faire ce qu'il manque, puis le brancher sur l'API (suppression de la logique locale).
3. Récurrences serveur, puis intérêts.
4. Pièces jointes.
5. Statistiques.
6. Simulations.
7. RGPD (export/suppression), pages légales, sauvegardes, CI, mise en production.
8. Évolutions après essai local (PLAN phases 8 et 10) : solde de départ, catégories à deux niveaux facultatives, page 404, simulation de trésorerie, tableau de bord (à décrire), refonte du style.
9. Administration et communication (PLAN phase 9) : catégories personnalisables, rôle admin, retours utilisateurs, notifications.

Ces deux dernières phases se terminent **avant** la mise en production (étape 7).

## 12. Points ouverts
Valeurs par défaut retenues, modifiables sans impact sur le reste :
- Rétention des sauvegardes : **30 jours** (donc données d'un compte supprimé purgées des sauvegardes sous 30 jours).
- Fenêtre du « rythme moyen » de la projection : **3 derniers mois**.
- Tranché : pas de ré-acceptation forcée des CGU (préavis 30 jours par e-mail et annonce, §13.6) ; retours utilisateurs conservés 30 jours après traitement, 90 jours au plus sans traitement (§13.5).

## 13. Administration et communication

Ajouté après essai local. Hors du périmètre de la v1 d'origine ; à terminer avant l'ouverture publique.

### 13.1 Rôle administrateur
- `User.role` vaut `USER` par défaut. Le rôle `ADMIN` s'attribue **uniquement par un script d'exploitation** (hors API HTTP, aucun écran ne permet de s'élever) ; il exige un e-mail vérifié.
- Les routes `/admin/*` sont protégées par un garde de rôle (401 sans session, 403 sinon). L'interface d'administration est une page dédiée, invisible pour les autres utilisateurs.
- Les actions d'administration (création/modification d'une catégorie globale, envoi d'une annonce ou d'une notification, traitement d'un retour) sont **journalisées** (qui, quoi, quand), sans donnée financière.

### 13.2 Statistiques de l'administrateur
Uniquement des **agrégats**, jamais le contenu financier d'un utilisateur : nombre d'utilisateurs (total, vérifiés, nouveaux sur 7/30 jours, actifs d'après `lastConnection`), volumes (comptes, transactions, récurrences, pièces jointes, stockage utilisé), taille de la base, état de l'API (disponibilité, durée de fonctionnement, latence de la base, dernière exécution des tâches planifiées, nombre d'erreurs depuis le démarrage). Les compteurs d'erreurs peuvent être en mémoire (remis à zéro au redémarrage) en v1.

### 13.3 Catégories globales
L'administrateur crée, renomme et archive des catégories et sous-catégories **globales** (visibles de tous les utilisateurs, déjà servies par l'API et non codées en dur dans le front). Une catégorie globale utilisée ne se supprime pas : elle s'archive (elle disparaît des listes de saisie mais reste sur les transactions existantes).

### 13.4 Catégories personnalisées (utilisateur)
Une page permet à l'utilisateur de créer ses catégories et sous-catégories (y compris sous une catégorie globale), de renommer ou masquer pour lui seul les catégories globales, et de supprimer les siennes avec réaffectation. Un masquage ne modifie jamais les transactions existantes.

### 13.5 Communication utilisateur → administrateur
- **Retour libre** : page avec un formulaire (type : avis, idée de fonctionnalité, problème ; texte limité en taille). Limites par utilisateur : **5 retours par 24 h** et **20 retours non traités** au plus. L'administrateur les lit dans une boîte de réception **triable par type et par statut** (nouveau, traité).
- **Conservation** : un retour est supprimé **30 jours après son passage à « traité »** ; un retour jamais traité est conservé **90 jours au maximum**, l'administrateur étant averti à l'approche de l'échéance. Durées en constantes modifiables.
- **Suggestion de catégorie** : à la création d'une catégorie personnelle, une case facultative « proposer cette catégorie à tous » crée une `CategorySuggestion` visible de l'administrateur, qui peut l'accepter (création de la catégorie globale), la refuser ou la traiter, et répondre à l'auteur.

### 13.6 Communication administrateur → utilisateur
- **Notifications** dans l'application : cloche dans la barre de navigation, avec compteur de notifications non lues.
- **Annonce à tous** (`Announcement`, ex. « Ajout d'une catégorie par défaut ») : un seul enregistrement, l'état « lu » étant suivi par utilisateur (pas de duplication par destinataire).
- **Notification personnelle** (`Notification` ciblée), par exemple en réponse à un retour ou à une suggestion.
- **Modification des CGU** : e-mail obligatoire (RGPD, envoi hors application, procédure d'exploitation) **et** annonce dans l'application, avec un **préavis de 30 jours** avant l'entrée en vigueur. La poursuite de l'utilisation vaut acceptation ; **aucune ré-acceptation explicite** n'est imposée, sauf changement important touchant un traitement fondé sur le consentement (alors à ajouter explicitement). `termsVersion` conserve la version acceptée à l'inscription.
- Contenu affiché comme du texte brut (jamais interprété comme HTML).

### 13.7 RGPD
Les retours, suggestions et notifications sont des données personnelles : ils figurent dans l'export (§8), sont supprimés avec le compte, et sont mentionnés dans la politique de confidentialité (finalité, durée de conservation).
