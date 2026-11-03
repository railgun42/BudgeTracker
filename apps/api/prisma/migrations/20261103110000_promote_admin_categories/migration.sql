-- Catégories créées par l'admin (Restauration, Covoiturage) passées « en dur » dans le seed : mêmes lignes
-- (ids, transactions, préférences conservés), clé de traduction posée, nom libre retiré. Sans effet si la base
-- ne les a pas, ou si le seed a déjà posé la clé (ordre documenté : migrate puis seed).
UPDATE "Category" SET "nameKey" = 'dining', "name" = NULL
WHERE "userId" IS NULL AND "nameKey" IS NULL AND "parentId" IS NULL AND lower("name") = 'restauration'
  AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "nameKey" = 'dining');

UPDATE "Category" c SET "nameKey" = v.key, "name" = NULL
FROM (VALUES
  ('fast-food', 'dining', 'dining.fast_food'),
  ('restaurant', 'dining', 'dining.restaurant'),
  ('snack', 'dining', 'dining.snack'),
  ('covoiturage', 'transport', 'transport.carpooling')
) AS v(name, parent, key), "Category" p
WHERE c."userId" IS NULL AND c."nameKey" IS NULL AND lower(c."name") = v.name
  AND p.id = c."parentId" AND p."nameKey" = v.parent
  AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "nameKey" = v.key);
