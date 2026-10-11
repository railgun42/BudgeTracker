import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// Catégories système globales (userId NULL) : nameKey = clé de traduction côté front.
// Les quatre premières sont utilisées par le code (intérêts, virement vers portefeuille,
// solde de départ, jambes de virement) ; les autres reprennent le jeu de base de l'ancien front.
export const SYSTEM_CATEGORIES: Record<string, string[]> = {
  interest: [],
  cash: [],
  opening_balance: [],
  transfer: [],
  entertainment: ['multimedia', 'outings'],
  sport: ['subscription', 'equipment'],
  groceries: ['food', 'hygiene'],
  housing: ['rent', 'utilities'],
};

// Idempotent : upsert par nameKey, relançable à volonté.
export async function seed(prisma: PrismaClient): Promise<void> {
  for (const [root, children] of Object.entries(SYSTEM_CATEGORIES)) {
    const parent = await prisma.category.upsert({ where: { nameKey: root }, update: {}, create: { nameKey: root } });
    for (const child of children) {
      const nameKey = `${root}.${child}`;
      await prisma.category.upsert({
        where: { nameKey },
        update: { parentId: parent.id },
        create: { nameKey, parentId: parent.id },
      });
    }
  }
}

// Lancé par `prisma db seed`, qui fournit DATABASE_URL (cf. prisma.config.ts).
if (require.main === module) {
  const prisma = new PrismaService();
  seed(prisma)
    .then(() => console.log('Seed : catégories système à jour'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
