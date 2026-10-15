import { Role } from '../enums';

// Utilisateur connecté (GET /me). Aucune donnée d'authentification ici (SPEC §3.2).
export interface UserDto {
  id: string;
  email: string;
  name: string;
  /** Horodatage ISO 8601 UTC. */
  lastConnection: string | null;
  /** Conditionne l'affichage du lien d'administration ; l'API vérifie le rôle à chaque requête /admin. */
  role: Role;
}
