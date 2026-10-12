-- DropForeignKey
ALTER TABLE "InterestCredit" DROP CONSTRAINT "InterestCredit_transactionId_fkey";

-- AlterTable
ALTER TABLE "InterestCredit" ALTER COLUMN "transactionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "InterestCredit" ADD CONSTRAINT "InterestCredit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
