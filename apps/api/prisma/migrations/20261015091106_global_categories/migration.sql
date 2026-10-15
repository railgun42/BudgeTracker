-- E38 : catégories globales gérées par l'administrateur (SPEC §13.3).
-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- Globale (userId NULL) : clé de traduction du seed (nameKey, éventuellement renommée par l'admin via name)
-- ou nom libre créé par l'admin (name seul). Perso : inchangé.
ALTER TABLE "Category" DROP CONSTRAINT "Category_system_or_personal";
ALTER TABLE "Category" ADD CONSTRAINT "Category_system_or_personal" CHECK (
  ("userId" IS NULL AND ("nameKey" IS NOT NULL OR "name" IS NOT NULL))
  OR ("userId" IS NOT NULL AND "nameKey" IS NULL AND "name" IS NOT NULL)
);

-- Doublon de nom refusé entre catégories globales sœurs (même parent, racines comprises), sans tenir compte
-- de la casse, archivées comprises (on restaure plutôt que recréer). Les libellés traduits du seed n'y figurent pas.
CREATE UNIQUE INDEX "Category_global_parent_lower_name_key" ON "Category" ("parentId", lower("name")) NULLS NOT DISTINCT
  WHERE "userId" IS NULL AND "name" IS NOT NULL;
