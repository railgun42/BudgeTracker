import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// Identité de l'éditeur : contenu à fournir et valider par l'éditeur avant l'ouverture publique
// (PLAN E29, R14 ; check-list E46). Une seule source pour les trois pages.
export const EDITOR = {
  name: '[À compléter : nom ou raison sociale]',
  status: '[À compléter : personne physique, ou forme sociale, capital, RCS/SIREN]',
  address: '[À compléter : adresse postale]',
  email: '[À compléter : adresse e-mail de contact]',
  publicationDirector: '[À compléter : directeur ou directrice de la publication]',
  mailProvider: '[À compléter : prestataire d’envoi d’e-mails (OVH, Brevo ou Resend)]',
  lastUpdate: '[À compléter : date de mise à jour]',
};

const HOST = 'OVH SAS, 2 rue Kellermann, 59100 Roubaix, France — www.ovhcloud.com';

@Component({
  selector: 'app-legal-notice-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="legal">
      <h1>Mentions légales</h1>

      <h2>Éditeur</h2>
      <p>
        {{ editor.name }}<br />
        {{ editor.status }}<br />
        {{ editor.address }}<br />
        Contact : {{ editor.email }}
      </p>
      <p>Directeur ou directrice de la publication : {{ editor.publicationDirector }}</p>

      <h2>Hébergeur</h2>
      <p>{{ host }}</p>
      <p>Les données (base de données, pièces jointes et sauvegardes) sont hébergées par OVH.</p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Le service BudgeTracker (code, textes, interface) est protégé. Les données et pièces jointes saisies par chaque
        utilisateur restent sa propriété.
      </p>

      <h2>Données personnelles</h2>
      <p>
        Voir la <a routerLink="/confidentialite">politique de confidentialité</a> et les
        <a routerLink="/cgu">conditions générales d’utilisation</a>.
      </p>
    </article>
  `,
})
export class LegalNoticePage {
  protected readonly editor = EDITOR;
  protected readonly host = HOST;
}

@Component({
  selector: 'app-privacy-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="legal">
      <h1>Politique de confidentialité</h1>
      <p class="muted">Dernière mise à jour : {{ editor.lastUpdate }}</p>

      <h2>Responsable du traitement</h2>
      <p>{{ editor.name }}, {{ editor.address }}. Contact : {{ editor.email }}.</p>

      <h2>Données collectées</h2>
      <ul>
        <li>Compte : adresse e-mail, nom, date de dernière connexion, mot de passe (stocké uniquement sous forme d’empreinte Argon2id) ou identifiant Google si vous vous connectez avec Google.</li>
        <li>Données que vous saisissez : comptes, transactions, catégories, tags, récurrences, taux d’intérêt, scénarios et simulations sauvegardées.</li>
        <li>Pièces jointes : justificatifs (images ou PDF) que vous choisissez d’ajouter.</li>
        <li>Données techniques : cookies de session et adresse IP utilisée pour limiter les tentatives de connexion. Les journaux techniques ne contiennent ni adresse e-mail ni montant.</li>
      </ul>
      <p>Aucun numéro de téléphone ni aucune donnée bancaire de connexion n’est demandé.</p>

      <h2>Finalités et bases légales</h2>
      <ul>
        <li>Fournir le service (historique, statistiques, simulations) : exécution du contrat (CGU).</li>
        <li>Envoyer les e-mails nécessaires (vérification de l’adresse, réinitialisation du mot de passe) : exécution du contrat.</li>
        <li>Sécuriser le service (limitation des tentatives, prévention des abus, sauvegardes) : intérêt légitime.</li>
      </ul>
      <p>Pas de publicité, pas de revente, pas de profilage, pas de cookie tiers ni de mesure d’audience.</p>

      <h2>Destinataires</h2>
      <ul>
        <li>OVH : hébergement des serveurs, du stockage des fichiers et des sauvegardes.</li>
        <li>{{ editor.mailProvider }} : envoi des e-mails de service (votre adresse e-mail uniquement).</li>
        <li>Google : uniquement si vous choisissez la connexion avec Google.</li>
      </ul>

      <h2>Durées de conservation</h2>
      <ul>
        <li>Données du compte : tant que le compte existe.</li>
        <li>Éléments supprimés (transactions, comptes, récurrences) : récupérables 30 jours, puis effacés définitivement.</li>
        <li>Suppression de votre compte : effacement immédiat de la base et des pièces jointes ; les sauvegardes chiffrées qui les contiennent expirent sous 30 jours.</li>
        <li>Lien de vérification d’e-mail : 24 heures ; lien de réinitialisation : 30 minutes ; session : 30 jours sans connexion.</li>
        <li>Adresse IP pour la limitation des tentatives : en mémoire, 1 heure au plus.</li>
      </ul>

      <h2>Sécurité</h2>
      <p>
        Connexion chiffrée (HTTPS), mots de passe hachés (Argon2id), cookies de session protégés, base de données non
        exposée sur Internet, disque et sauvegardes chiffrés, pièces jointes accessibles uniquement par des liens
        temporaires.
      </p>
      <p>
        <strong>Limite :</strong> les données ne sont pas chiffrées de bout en bout. L’administrateur du service peut
        donc techniquement y accéder ; il ne le fait que pour la maintenance ou à votre demande.
      </p>

      <h2>Cookies</h2>
      <p>
        Seuls des cookies strictement nécessaires sont utilisés (<code>access_token</code>, <code>refresh_token</code>,
        <code>csrf_token</code>, <code>oauth_state</code>) : session et protection contre la falsification de requêtes.
        Ils sont exemptés de consentement.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité.
        Depuis <a routerLink="/me">Mon compte</a>, vous pouvez exporter toutes vos données (JSON ou CSV) et supprimer
        votre compte. Pour toute autre demande : {{ editor.email }}. Vous pouvez aussi adresser une réclamation à la CNIL
        (www.cnil.fr).
      </p>
    </article>
  `,
})
export class PrivacyPage {
  protected readonly editor = EDITOR;
}

@Component({
  selector: 'app-terms-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="legal">
      <h1>Conditions générales d’utilisation</h1>
      <p class="muted">Dernière mise à jour : {{ editor.lastUpdate }}</p>

      <h2>Objet</h2>
      <p>
        BudgeTracker, édité par {{ editor.name }}, est un outil gratuit de suivi de transactions : historique,
        statistiques et simulations. Créer un compte vaut acceptation des présentes conditions.
      </p>

      <h2>Compte</h2>
      <p>
        L’inscription exige une adresse e-mail valide et vérifiée. Vous êtes responsable de la confidentialité de votre
        mot de passe et de l’exactitude des informations saisies.
      </p>

      <h2>Utilisation</h2>
      <ul>
        <li>Les soldes, statistiques et simulations sont calculés à partir de vos seules saisies ; ils sont indicatifs et ne constituent ni un relevé bancaire ni un conseil financier.</li>
        <li>Les pièces jointes doivent être licites : images (JPEG, PNG, WebP) ou PDF, 5 Mo par fichier, dans la limite de votre quota de stockage (200 Mo par défaut).</li>
        <li>Sont interdits : l’accès aux données d’autrui, le contournement des mesures de sécurité, l’usage abusif ou automatisé du service.</li>
      </ul>

      <h2>Vos données</h2>
      <p>
        Vos données vous appartiennent. Leur traitement est décrit dans la
        <a routerLink="/confidentialite">politique de confidentialité</a>. Vous pouvez les exporter et supprimer votre
        compte à tout moment depuis <a routerLink="/me">Mon compte</a>.
      </p>

      <h2>Disponibilité et responsabilité</h2>
      <p>
        Le service est fourni en l’état, sans garantie de disponibilité continue (maintenance, incidents). Conservez vos
        justificatifs originaux : l’éditeur ne saurait être tenu responsable d’une décision prise sur la base des calculs
        du service ni d’une perte de données au-delà des sauvegardes décrites.
      </p>

      <h2>Suspension et résiliation</h2>
      <p>
        Vous pouvez supprimer votre compte à tout moment. L’éditeur peut suspendre un compte en cas de manquement aux
        présentes conditions, après en avoir informé son titulaire sauf urgence.
      </p>

      <h2>Modification et droit applicable</h2>
      <p>
        Toute modification des conditions est signalée aux utilisateurs avant son entrée en vigueur. Les présentes
        conditions sont soumises au droit français. Contact : {{ editor.email }}.
      </p>
    </article>
  `,
})
export class TermsPage {
  protected readonly editor = EDITOR;
}
