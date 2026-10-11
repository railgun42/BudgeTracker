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
