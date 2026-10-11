import { LocalDate } from '@budgetracker/shared';

/** Jour local du navigateur en 'YYYY-MM-DD' (le format sv-SE est l'ISO), sans passer par l'heure UTC. */
export const today = (): LocalDate => new Date().toLocaleDateString('sv-SE');
