import { PrismaService } from '../../src/prisma/prisma.service';

// Tables sans colonne userId : rattachées à l'utilisateur par leur parent. Une nouvelle table fait échouer
// le comptage tant qu'elle n'est pas ajoutée ici (ou ne porte pas userId).
const CHILD_TABLES: Record<string, string> = {
  User: 'SELECT count(*) FROM "User" WHERE id = $1::uuid',
  TransactionTag: 'SELECT count(*) FROM "TransactionTag" x JOIN "Transaction" t ON t.id = x."transactionId" WHERE t."userId" = $1::uuid',
  TransactionTemplate: 'SELECT count(*) FROM "TransactionTemplate" x JOIN "Recurrence" r ON r.id = x."recurrenceId" WHERE r."userId" = $1::uuid',
  TemplateTag:
    'SELECT count(*) FROM "TemplateTag" x JOIN "TransactionTemplate" tt ON tt.id = x."templateId" JOIN "Recurrence" r ON r.id = tt."recurrenceId" WHERE r."userId" = $1::uuid',
  InterestCredit: 'SELECT count(*) FROM "InterestCredit" x JOIN "Account" a ON a.id = x."accountId" WHERE a."userId" = $1::uuid',
};

// Nombre de lignes de l'utilisateur dans chaque table de la base (« rien n'est écrit »).
export async function rowCounts(prisma: PrismaService, userId: string): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ table_name: string; has_user: boolean }[]>`
    SELECT table_name, bool_or(column_name = 'userId') AS has_user
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' GROUP BY table_name`;
  expect(tables.filter((t) => !t.has_user).map((t) => t.table_name).sort()).toEqual(Object.keys(CHILD_TABLES).sort());
  const counts: Record<string, number> = {};
  for (const { table_name, has_user } of tables) {
    const sql = has_user ? `SELECT count(*) FROM "${table_name}" WHERE "userId" = $1::uuid` : CHILD_TABLES[table_name];
    counts[table_name] = Number((await prisma.$queryRawUnsafe<{ count: bigint }[]>(sql, userId))[0].count);
  }
  return counts;
}
