-- E41 (suite) : la catégorie de l'auteur devient la globale ; masquée par défaut pour les inscrits antérieurs.
-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "hiddenForUsersBefore" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CategorySuggestion" ADD COLUMN     "categoryId" UUID;

-- CreateIndex
CREATE INDEX "CategorySuggestion_categoryId_idx" ON "CategorySuggestion"("categoryId");

-- AddForeignKey
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
