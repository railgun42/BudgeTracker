-- E31 : catégorie facultative (SPEC §3.2). Les clés étrangères (NO ACTION, DEFERRABLE) sont inchangées.
-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "categoryId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TransactionTemplate" ALTER COLUMN "categoryId" DROP NOT NULL;
