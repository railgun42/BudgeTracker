-- Suppression d'une catégorie globale inutilisée : les suggestions traitées sous elle restent, sans parent.
-- DropForeignKey
ALTER TABLE "CategorySuggestion" DROP CONSTRAINT "CategorySuggestion_parentId_fkey";

-- AddForeignKey
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
