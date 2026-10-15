// Enums string du domaine ; valeurs identiques aux enums Prisma (vérifié par test/enums.test.ts).

export enum TrackingType {
  NORMAL = 'NORMAL',
  NOT_TRACKED = 'NOT_TRACKED',
  WITH_INTEREST = 'WITH_INTEREST',
}

// Un virement n'est pas un type : c'est une transaction dont `transferId` est non nul.
export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum IntervalUnit {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

// ADMIN : attribué uniquement hors API HTTP (script d'exploitation, SPEC §13.1).
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

// Retour utilisateur (SPEC §13.5) : avis, idée de fonctionnalité, problème.
export enum FeedbackType {
  OPINION = 'OPINION',
  IDEA = 'IDEA',
  PROBLEM = 'PROBLEM',
}
