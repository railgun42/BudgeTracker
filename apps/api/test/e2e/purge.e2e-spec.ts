import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { PurgeJob } from '../../src/jobs/purge.job';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E13 — purge des suppressions logiques. Horloge injectée (purge(now)) et deletedAt antidatés :
// les lignes supprimées « maintenant » par les autres fichiers de test (en parallèle) ne sont pas touchées.
describe('Purge des suppressions logiques (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let job: PurgeJob;
  let users: TwoUsers;
  let a: TestUser;
  let categoryId: string;
  const NOW = new Date();
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    job = app.get(PurgeJob);
    await seed(prisma);
    categoryId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'cash' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const newAccount = async () => (await a.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType: 'NORMAL' }).expect(201)).body.id as string;
  const newTransaction = async (accountId: string) =>
    (await a.call('post', '/api/v1/transactions').send({ accountId, categoryId, amountCents: 1_000, date: '2026-06-01' }).expect(201)).body.id as string;
  const newRecurrence = async (accountId: string, deletedAt: Date | null = null) =>
    (await prisma.recurrence.create({ data: { userId: a.id, accountId, interval: 1, unit: 'MONTH', startDate: new Date('2026-01-31'), anchorDay: 31, deletedAt } })).id;
  const newTransfer = async (fromAccountId: string, toAccountId: string) =>
    (await a.call('post', '/api/v1/transfers').send({ fromAccountId, toAccountId, amountCents: 2_500, date: '2026-06-01' }).expect(201)).body;
  const exists = {
    transaction: async (id: string) => (await prisma.transaction.count({ where: { id } })) === 1,
    account: async (id: string) => (await prisma.account.count({ where: { id } })) === 1,
    recurrence: async (id: string) => (await prisma.recurrence.count({ where: { id } })) === 1,
  };

  it('transaction, compte, récurrence : supprimés il y a 29 j conservés, il y a 31 j purgés', async () => {
    const account = await newAccount();
    const [t29, t31] = [await newTransaction(account), await newTransaction(account)];
    const [a29, a31] = [await newAccount(), await newAccount()];
    const [r29, r31] = [await newRecurrence(account, ago(29)), await newRecurrence(account, ago(31))];
    await prisma.transaction.update({ where: { id: t29 }, data: { deletedAt: ago(29) } });
    await prisma.transaction.update({ where: { id: t31 }, data: { deletedAt: ago(31) } });
    await prisma.account.update({ where: { id: a29 }, data: { deletedAt: ago(29) } });
    await prisma.account.update({ where: { id: a31 }, data: { deletedAt: ago(31) } });

    await job.purge(NOW);

    expect([await exists.transaction(t29), await exists.transaction(t31)]).toEqual([true, false]);
    expect([await exists.account(a29), await exists.account(a31)]).toEqual([true, false]);
    expect([await exists.recurrence(r29), await exists.recurrence(r31)]).toEqual([true, false]);
    // Supprimée il y a 29 j : encore restaurable depuis l'UI.
    await a.call('post', `/api/v1/transactions/${t29}/restore`).expect(200);
  });

  it('rien de supprimé ⇒ rien de purgé, même daté de plus de 30 j', async () => {
    const account = await newAccount();
    await prisma.account.update({ where: { id: account }, data: { createdAt: ago(400) } });
    const transaction = await newTransaction(account);
    const recurrence = await newRecurrence(account);
    await job.purge(NOW);
    expect([await exists.account(account), await exists.transaction(transaction), await exists.recurrence(recurrence)]).toEqual([true, true, true]);
  });

  it('virement purgé en entier (Transfer + 2 jambes) ; 29 j ⇒ conservé', async () => {
    const [from, to] = [await newAccount(), await newAccount()];
    const [old, recent] = [await newTransfer(from, to), await newTransfer(from, to)];
    await a.call('delete', `/api/v1/transactions/${old.debit.id}`).expect(204);
    await a.call('delete', `/api/v1/transactions/${recent.credit.id}`).expect(204);
    for (const [t, days] of [[old, 31], [recent, 29]] as const) {
      await prisma.transfer.update({ where: { id: t.id }, data: { deletedAt: ago(days) } });
      await prisma.transaction.updateMany({ where: { transferId: t.id }, data: { deletedAt: ago(days) } });
    }

    await job.purge(NOW);

    expect(await prisma.transfer.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { id: { in: [old.debit.id, old.credit.id] } } })).toBe(0);
    expect(await prisma.transaction.count({ where: { transferId: recent.id } })).toBe(2);
    await a.call('post', `/api/v1/transactions/${recent.debit.id}/restore`).expect(200);
  });

  it('la purge d’un compte emporte ses transactions et récurrences ; un virement touchant ce compte part en entier', async () => {
    const [purged, kept] = [await newAccount(), await newAccount()];
    const transaction = await newTransaction(purged);
    const recurrence = await newRecurrence(purged);
    const transfer = await newTransfer(kept, purged);
    const keptTransaction = await newTransaction(kept);
    await a.call('delete', `/api/v1/accounts/${purged}`).expect(204);
    await prisma.account.update({ where: { id: purged }, data: { deletedAt: ago(31) } });

    await job.purge(NOW);

    expect(await exists.account(purged)).toBe(false);
    expect(await exists.transaction(transaction)).toBe(false);
    expect(await exists.recurrence(recurrence)).toBe(false);
    // Pas de jambe orpheline sur le compte conservé.
    expect(await prisma.transfer.count({ where: { id: transfer.id } })).toBe(0);
    expect(await exists.transaction(transfer.debit.id)).toBe(false);
    expect(await exists.account(kept)).toBe(true);
    expect(await exists.transaction(keptTransaction)).toBe(true);
    expect((await a.call('get', `/api/v1/accounts/${kept}/balance`).expect(200)).body.forecastCents).toBe(-1_000);
  });

  it('les occurrences générées survivent à la purge de leur récurrence (recurrenceId ⇒ NULL)', async () => {
    const account = await newAccount();
    const recurrence = await newRecurrence(account, ago(31));
    const { id } = await prisma.transaction.create({
      data: { userId: a.id, accountId: account, categoryId, name: '', type: 'DEBIT', amountCents: 500n, date: new Date('2026-01-31'), recurrenceId: recurrence, occurrenceDate: new Date('2026-01-31') },
    });
    await job.purge(NOW);
    expect(await exists.recurrence(recurrence)).toBe(false);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).recurrenceId).toBeNull();
  });
});
