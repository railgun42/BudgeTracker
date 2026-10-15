// Types, enums et helpers du domaine partagés entre apps/api et apps/web.
// DTO : formes JSON échangées (montants en centimes, jours en LocalDate, jamais de Date).
export * from './enums';
export * from './money';
export * from './local-date';
export * from './dto/user';
export * from './dto/account';
export * from './dto/category';
export * from './dto/transaction';
export * from './dto/transfer';
export * from './dto/recurrence';
export * from './dto/stats';
export * from './dto/simulation';
export * from './dto/scenario';
export * from './dto/admin';
