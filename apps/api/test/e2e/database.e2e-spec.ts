import { seed, SYSTEM_CATEGORIES } from '../../prisma/seed';
import { testPrisma, uniqueEmail } from '../helpers/db';

// E3 — contraintes du schéma v1, vérifiées contre Postgres (pas de mock).
describe('Schéma v1 (intégration Postgres)', () => {
  const prisma = testPrisma();
  const userIds: string[] = [];

  const createUser = async () => {
    const user = await prisma.user.create({ data: { email: uniqueEmail(), name: 'Test' } });
    userIds.push(user.id);
    return user;
  };

  // Utilisateur + compte + catégorie perso, prêts pour insérer des transactions.
  const fixture = async () => {
    const user = await createUser();
    const account = await prisma.account.create({ data: { userId: user.id, name: 'Courant', trackingType: 'NORMAL' } });
    const category = await prisma.category.create({ data: { userId: user.id, name: 'Perso' } });
    const tx = (data: { amountCents: bigint; recurrenceId?: string; occurrenceDate?: Date }) =>
      prisma.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          categoryId: category.id,
          name: 'Achat',
          date: new Date('2026-01-31'),
          type: 'DEBIT',
          ...data,
        },
      });
    return { user, account, category, tx };
  };

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('montant ≤ 0 refusé par le CHECK, montant > 0 accepté', async () => {
    const { tx } = await fixture();
    await expect(tx({ amountCents: 0n })).rejects.toThrow(/Transaction_amountCents_positive/);
    await expect(tx({ amountCents: -1n })).rejects.toThrow(/Transaction_amountCents_positive/);
    await expect(tx({ amountCents: 1n })).resolves.toMatchObject({ amountCents: 1n });
  });

  it('(recurrenceId, occurrenceDate) en double refusé, même si la première est supprimée logiquement', async () => {
    const { user, account, category, tx } = await fixture();
    const recurrence = await prisma.recurrence.create({
      data: {
        userId: user.id,
        accountId: account.id,
        interval: 1,
        unit: 'MONTH',
        startDate: new Date('2026-01-31'),
        anchorDay: 31,
        template: { create: { name: 'Loyer', amountCents: 80000n, type: 'DEBIT', categoryId: category.id } },
      },
    });
    const occurrence = { amountCents: 80000n, recurrenceId: recurrence.id, occurrenceDate: new Date('2026-02-28') };
    const first = await tx(occurrence);
    await expect(tx(occurrence)).rejects.toMatchObject({ code: 'P2002' });

    await prisma.transaction.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(tx(occurrence)).rejects.toMatchObject({ code: 'P2002' });
    // Une autre date reste possible ; une occurrence sans date ne l'est pas.
    await expect(tx({ ...occurrence, occurrenceDate: new Date('2026-03-31') })).resolves.toBeDefined();
    await expect(tx({ amountCents: 1n, recurrenceId: recurrence.id })).rejects.toThrow(/Transaction_occurrenceDate_required/);
  });

  it('deux utilisateurs de même e-mail refusés, e-mail non normalisé refusé', async () => {
    const user = await createUser();
    await expect(prisma.user.create({ data: { email: user.email, name: 'Doublon' } })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(prisma.user.create({ data: { email: user.email.toUpperCase(), name: 'Casse' } })).rejects.toThrow(
      /User_email_lowercase/,
    );
  });

  it('tag unique par utilisateur sans tenir compte de la casse', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await prisma.tag.create({ data: { userId: a.id, name: 'Vacances' } });
    await expect(prisma.tag.create({ data: { userId: a.id, name: 'VACANCES' } })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(prisma.tag.create({ data: { userId: b.id, name: 'vacances' } })).resolves.toBeDefined();
  });

  it('catégorie utilisée non supprimable, mais la suppression de l’utilisateur emporte tout', async () => {
    const { user, account, category, tx } = await fixture();
    await tx({ amountCents: 500n });
    const sub = await prisma.category.create({ data: { userId: user.id, name: 'Sous', parentId: category.id } });
    // Chemin de cascade indirect (User → Recurrence → TransactionTemplate → Category).
    await prisma.recurrence.create({
      data: {
        userId: user.id,
        accountId: account.id,
        interval: 1,
        unit: 'WEEK',
        startDate: new Date('2026-01-05'),
        anchorDay: 5,
        template: { create: { name: 'Sport', amountCents: 1500n, type: 'DEBIT', categoryId: sub.id } },
      },
    });
    await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toThrow(/categoryId_fkey|parentId_fkey/);
    await expect(prisma.category.delete({ where: { id: sub.id } })).rejects.toThrow(/categoryId_fkey/);

    await prisma.user.delete({ where: { id: user.id } });
    const where = { userId: user.id };
    const counts = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.category.count({ where }),
      prisma.recurrence.count({ where }),
      prisma.account.count({ where }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it('seed idempotent : catégories système sur 2 niveaux, inchangées après une 2ᵉ exécution', async () => {
    await seed(prisma);
    const count = () => prisma.category.count({ where: { userId: null } });
    const before = await count();
    await seed(prisma);
    expect(await count()).toBe(before);

    const expected = Object.values(SYSTEM_CATEGORIES).reduce((n, children) => n + 1 + children.length, 0);
    expect(before).toBe(expected);
    const rent = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'housing.rent' }, include: { parent: true } });
    expect(rent.parent?.nameKey).toBe('housing');
    expect(rent.parent?.parentId).toBeNull();
    for (const key of ['interest', 'cash', 'opening_balance']) {
      await expect(prisma.category.findUnique({ where: { nameKey: key } })).resolves.not.toBeNull();
    }
  });
});
