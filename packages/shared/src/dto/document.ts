import type { LocalDate } from '../local-date';
import type { AttachmentDto } from './transaction';

// Coffre-fort (/me/coffre) : toutes les pièces jointes de l'utilisateur, plus les documents déposés sans transaction.
// GET /documents : liste complète (tri et filtres côté client) ; pièces de transactions à la corbeille exclues.
// POST /documents (multipart, champ `file`) : dépôt direct, mêmes règles que POST /transactions/:id/attachment.
// GET /documents/:id/url[?download=1] : AttachmentUrlDto ; `download=1` ⇒ téléchargement sous le nom d'origine.
// PUT /documents/:id/tags : remplace l'ensemble des tags (tag d'un autre utilisateur ⇒ 404).
// DELETE /documents/:id : supprime le fichier ; la transaction liée perd son justificatif.
export interface DocumentDto extends AttachmentDto {
  /** Horodatage ISO UTC de l'ajout. */
  createdAt: string;
  tagIds: string[];
  /** `null` = déposé directement dans le coffre. */
  transaction: { id: string; name: string; date: LocalDate; accountId: string } | null;
}

export interface DocumentTagsInput {
  tagIds: string[];
}
