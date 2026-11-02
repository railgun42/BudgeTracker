import { Role } from '../enums';

// Utilisateur connecté (GET /me). Aucune donnée d'authentification ici (SPEC §3.2).
export interface UserDto {
  id: string;
  email: string;
  name: string;
  /** Horodatage ISO 8601 UTC. */
  lastConnection: string | null;
  /** Date d'inscription, horodatage ISO 8601 UTC. */
  createdAt: string;
  /** Conditionne l'affichage du lien d'administration ; l'API vérifie le rôle à chaque requête /admin. */
  role: Role;
}

// Stockage des pièces jointes (GET /me/storage), en octets.
export interface StorageUsageDto {
  usedBytes: number;
  quotaBytes: number;
}
