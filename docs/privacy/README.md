# Pages légales et registre des traitements

Les textes publiés sont dans `apps/web/src/app/features/legal/legal-pages.ts` (routes publiques
`/mentions-legales`, `/confidentialite`, `/cgu`, liées dans le pied de page et à l'inscription).
Ce document en est la référence interne : toute modification du code qui change une donnée
collectée ou une durée ci-dessous doit mettre à jour les pages.

## À fournir / valider par l'éditeur (bloquant avant ouverture publique, PLAN R14 / E46)

Tout est centralisé dans la constante `EDITOR` de `legal-pages.ts` (valeurs `[À compléter …]`) :

- [ ] Identité : nom ou raison sociale, statut (forme, capital, RCS/SIREN le cas échéant)
- [ ] Adresse postale et e-mail de contact (aussi utilisé pour l'exercice des droits RGPD)
- [ ] Directeur ou directrice de la publication
- [ ] Prestataire e-mail retenu (OVH, Brevo ou Resend) et, s'il est hors UE, garanties de transfert
- [ ] Localisation des serveurs OVH choisie (datacenter UE)
- [ ] Date de mise à jour des textes
- [ ] Relecture juridique des trois pages

## Registre des traitements (RGPD art. 30)

| Traitement | Données | Base légale | Conservation | Source dans le code |
|---|---|---|---|---|
| Compte utilisateur | e-mail, nom, dernière connexion, hash Argon2id ou identifiant Google | Contrat | Durée du compte | `prisma/schema.prisma` (User, Credential, OAuthIdentity) |
| Suivi financier | comptes, transactions, catégories, tags, récurrences, taux, scénarios et simulations sauvegardées | Contrat | Durée du compte ; éléments supprimés purgés après 30 j | `jobs/purge.job.ts` (`PURGE_AFTER_DAYS`) |
| Pièces jointes | images / PDF (5 Mo, quota 200 Mo) | Contrat | Avec la transaction ; purge S3 | `attachments/`, `storage/` |
| E-mails de service | e-mail, jeton haché | Contrat | Vérification 24 h, reset 30 min | `auth/auth.service.ts`, `auth/password-reset.service.ts` |
| Session | cookies `access_token` (15 min), `refresh_token` (30 j), `csrf_token`, `oauth_state` (10 min) | Strictement nécessaire | Voir durées | `common/cookies.ts` |
| Sécurité | IP (limitation de débit), compteur d'échecs par compte | Intérêt légitime | En mémoire, ≤ 1 h | `auth/auth.module.ts`, `auth/auth.service.ts` |
| Sauvegardes | copie chiffrée de la base | Intérêt légitime | 30 jours (SPEC §12) | E45 |

Suppression de compte : effacement immédiat en base, des objets S3 et des sessions (`gdpr/`) ;
les sauvegardes qui les contiennent expirent sous 30 jours. Export JSON/CSV : `GET /api/v1/me/export`.

Limite assumée (SPEC §5, R12) : pas de chiffrement de bout en bout, l'administrateur peut
techniquement lire les données ; c'est écrit dans la politique de confidentialité.
