# BudgeTracker — Spécification

> Statut : v1 validée par interview. Tous les choix sont tranchés ; seules deux valeurs par défaut (§12) restent modifiables.

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
- **Isolation** : toute table métier porte `userId`, et chaque requête filtre dessus (test automatisé obligatoire sur chaque endpoint).
- **Concurrence** : colonne `version` sur les entités modifiables ; une écriture sur une version périmée renvoie **409** et l'UI propose de recharger.
- **Suppression logique** : `deletedAt` sur transactions, comptes, récurrences. Annulation possible depuis l'UI. Purge définitive après **30 jours** et immédiate lors de la suppression du compte utilisateur. Toutes les requêtes filtrent `deletedAt IS NULL`.

### 3.2 Entités
- **User** : id, email (unique, vérifié), nom, `lastConnection`. Le champ `phoneNumber` est **supprimé** (minimisation RGPD). Aucune donnée d'authentification dans le modèle partagé.
- **Credentials** (API uniquement) : hash Argon2id, jamais exposé. Plus lien OAuth Google (`provider`, `providerId`).
- **Account** : name, `trackingType`, userId. **Pas de champ solde** : calculé.
- **TrackingType**
  - `NORMAL` : solde = somme des transactions (CREDIT +, DEBIT −).
  - `NOT_TRACKED` : portefeuille. Pas de solde ni d'entrées ; sert à l'historique et aux statistiques (dépenses seulement).
  - `WITH_INTEREST` : comme NORMAL, avec crédit d'intérêts automatique (voir 3.5).
- **Transaction** : id (UUID), accountId, name, date, `amountCents` (> 0), type (`DEBIT` | `CREDIT` | `TRANSFER` via `transferId`), details, categoryId, tags, 0..1 pièce jointe, `recurrenceId` (nullable), `version`, `deletedAt`.
- **Category** : 2 niveaux max. **Catégories système globales fixes** (non modifiables, libellés traduisibles) + **catégories personnelles** de l'utilisateur. Une catégorie utilisée ne se supprime pas en cascade : les perso se **réaffectent** puis se suppriment, les système ne se suppriment pas.
- **Tag** : libre, transverse, par utilisateur.
- **Recurrence** + **TransactionTemplate** : `interval` + `unit` (DAY/WEEK/MONTH/YEAR), startDate, endDate nullable, lastGeneration.
- **Scenario** : userId, nom, paramètres JSON (voir §6).
- **InterestRate** : accountId, taux annuel, date d'effet (historique de taux).

### 3.3 Solde
`SUM` SQL indexé sur `(accountId, date)`. Jamais en chargeant toutes les transactions. Une transaction antidatée recalcule naturellement le solde. Les transactions futures sont incluses dans « solde prévisionnel », pas dans « solde actuel ».

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

## 6. Statistiques et simulations

### Statistiques
Répartition par catégorie/tag, évolution mensuelle revenus/dépenses, par compte ou global. Les `TRANSFER` sont exclus. Calcul en SQL agrégé.

### Simulations (calcul serveur)
Fonctions **pures**, testées unitairement, indépendantes de la BDD :
1. **Projection du solde** : solde actuel + récurrences futures + rythme moyen de dépenses non récurrentes (fenêtre configurable).
2. **Scénarios « et si »** : un `Scenario` sauvegardé = paramètres JSON (ex. −100 €/mois sur une catégorie, nouvel abonnement, achat à crédit) appliqués à une **copie virtuelle** du compte ; les vraies données ne sont jamais modifiées. Comparaison de scénarios côte à côte.
3. **Objectifs d'épargne** : « X € dans N mois » ⇒ effort mensuel requis et progression.
4. **Calculateurs crédit / placement** : mensualités, coût total, intérêts composés, inflation. Aucun accès aux transactions.

## 7. UX
- **Mobile-first**, responsive, en ligne uniquement. Saisie d'une dépense en **3 champs** (montant, catégorie, compte) avec date par défaut = aujourd'hui, détails optionnels.
- Historique paginé par curseur (50 par page), filtres date/catégorie/tag/compte.
- Annulation d'une suppression (bannière « Annuler »), message clair sur un conflit 409.
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

## 11. Découpage proposé
1. API : auth, utilisateurs, comptes, catégories, transactions (+ virements, verrou, soft delete), solde.
2. **Audit du front existant** (`apps/web`) : vérifier ce qui est réutilisable, refaire ce qui ne l'est pas et faire ce qu'il manque, puis le brancher sur l'API (suppression de la logique locale).
3. Récurrences serveur, puis intérêts.
4. Pièces jointes.
5. Statistiques.
6. Simulations.
7. RGPD (export/suppression), pages légales, sauvegardes, CI, mise en production.

## 12. Points ouverts
Valeurs par défaut retenues, modifiables sans impact sur le reste :
- Rétention des sauvegardes : **30 jours** (donc données d'un compte supprimé purgées des sauvegardes sous 30 jours).
- Fenêtre du « rythme moyen » de la projection : **3 derniers mois**.
