-- E41 : suggestions de catégorie globale (SPEC §13.5).
-- CreateEnum
CREATE TYPE "CategorySuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'TREATED');

-- CreateTable
CREATE TABLE "CategorySuggestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "status" "CategorySuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "treatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategorySuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategorySuggestion_userId_createdAt_idx" ON "CategorySuggestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CategorySuggestion_status_createdAt_idx" ON "CategorySuggestion"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Traitée (acceptée, refusée ou traitée) ⇔ date de traitement.
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_treated_check" CHECK (("status" = 'PENDING') = ("treatedAt" IS NULL));
