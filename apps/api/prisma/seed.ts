import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// Catégories système globales (userId NULL) : nameKey = clé de traduction côté front.
// Les quatre premières sont techniques, posées par le code (intérêts, virement vers portefeuille,
// solde de départ, jambes de virement) et jamais proposées à la saisie. Les autres : catégorie générale
// puis sous-catégories précises (SPEC §3.2). Ne jamais retirer une clé : des transactions la référencent
// (le seed n'ajoute que ; une clé obsolète se réaffecte dans une migration).
export const SYSTEM_CATEGORIES: Record<string, string[]> = {
  interest: [],
  cash: [],
  opening_balance: [],
  transfer: [],
  entertainment: ['video_games', 'multimedia', 'outings'],
  sport: ['subscription', 'license', 'session', 'equipment'],
  groceries: ['food', 'clothing', 'hygiene'],
  housing: ['rent', 'utilities', 'insurance'],
  transport: ['fuel', 'public_transport', 'maintenance'],
  health: ['doctor', 'pharmacy'],
  income: ['salary', 'refund'],
};

// L'upsert Prisma n'est pas atomique (SELECT puis INSERT) : deux seeds simultanés (suites Jest en parallèle
// sur une base vierge) peuvent se heurter sur nameKey. Le perdant relance : la ligne existe alors.
const retryOnConflict = <T>(op: () => Promise<T>): Promise<T> =>
  op().catch((e: { code?: string }) => {
    if (e.code === 'P2002') return op();
    throw e;
  });

// Idempotent : upsert par nameKey, relançable à volonté, y compris en parallèle.
export async function seed(prisma: PrismaClient): Promise<void> {
  for (const [root, children] of Object.entries(SYSTEM_CATEGORIES)) {
    const parent = await retryOnConflict(() => prisma.category.upsert({ where: { nameKey: root }, update: {}, create: { nameKey: root } }));
    for (const child of children) {
      const nameKey = `${root}.${child}`;
      await retryOnConflict(() =>
        prisma.category.upsert({
          where: { nameKey },
          update: { parentId: parent.id },
          create: { nameKey, parentId: parent.id },
        }),
      );
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
