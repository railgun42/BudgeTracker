import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { balanceSql } from '../../src/balance/balance.service';
import { Prisma } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E11 — solde. L'isolation A/B de la route est dans test/helpers/isolation-registry.ts.
describe('Solde (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let groceries: string;
  const TODAY = '2026-06-15';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    groceries = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'groceries' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const newAccount = async (body: object = {}) =>
    (await a.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType: 'NORMAL', ...body }).expect(201)).body.id as string;
  const add = async (accountId: string, date: string, amountCents: number, type = 'DEBIT') =>
    (await a.call('post', '/api/v1/transactions').send({ accountId, categoryId: groceries, amountCents, date, type }).expect(201)).body.id as string;
  const balance = async (accountId: string, today: string | null = TODAY) =>
    (await a.call('get', `/api/v1/accounts/${accountId}/balance${today ? `?today=${today}` : ''}`).expect(200)).body;

  it('compte vide ⇒ 0 / 0', async () => {
    expect(await balance(await newAccount())).toEqual({ currentCents: 0, forecastCents: 0 });
  });

  it('CREDIT +, DEBIT −, solde de départ inclus ; aujourd’hui compte dans l’actuel', async () => {
    const id = await newAccount({ openingBalance: { amountCents: 10_000, date: '2026-01-01' } });
    await add(id, '2026-02-01', 2_550, 'CREDIT');
    await add(id, TODAY, 1_234);
    expect(await balance(id)).toEqual({ currentCents: 11_316, forecastCents: 11_316 });
  });

  it('solde de départ négatif', async () => {
    const id = await newAccount({ openingBalance: { amountCents: -500, date: '2026-01-01' } });
    expect(await balance(id)).toEqual({ currentCents: -500, forecastCents: -500 });
  });

  it('transaction future : seul le prévisionnel change', async () => {
    const id = await newAccount();
    await add(id, '2026-06-01', 1_000, 'CREDIT');
    await add(id, '2026-06-16', 300); // demain
    expect(await balance(id)).toEqual({ currentCents: 1_000, forecastCents: 700 });
    // Le lendemain, elle entre dans l'actuel.
    expect(await balance(id, '2026-06-16')).toEqual({ currentCents: 700, forecastCents: 700 });
  });

  it('transaction antidatée : le solde actuel est recalculé', async () => {
    const id = await newAccount();
    await add(id, '2026-06-01', 1_000, 'CREDIT');
    await add(id, '2020-01-01', 400);
    expect(await balance(id)).toEqual({ currentCents: 600, forecastCents: 600 });
  });

  it('modifier la date d’une transaction la fait passer de l’actuel au prévisionnel', async () => {
    const id = await newAccount();
    const tx = await add(id, '2026-06-01', 1_000, 'CREDIT');
    await a.call('patch', `/api/v1/transactions/${tx}`).send({ version: 1, date: '2026-07-01' }).expect(200);
    expect(await balance(id)).toEqual({ currentCents: 0, forecastCents: 1_000 });
  });

  it('supprimée logiquement ⇒ exclue ; restaurée ⇒ réintégrée', async () => {
    const id = await newAccount();
    await add(id, '2026-06-01', 1_000, 'CREDIT');
    const tx = await add(id, '2026-06-02', 300);
    const future = await add(id, '2026-12-01', 50);
    await a.call('delete', `/api/v1/transactions/${tx}`).expect(204);
    await a.call('delete', `/api/v1/transactions/${future}`).expect(204);
    expect(await balance(id)).toEqual({ currentCents: 1_000, forecastCents: 1_000 });
    await a.call('post', `/api/v1/transactions/${tx}/restore`).expect(200);
    expect(await balance(id)).toEqual({ currentCents: 700, forecastCents: 700 });
  });

  it('compte NOT_TRACKED ⇒ null, même avec des dépenses', async () => {
    const id = await newAccount({ trackingType: 'NOT_TRACKED' });
    await add(id, '2026-06-01', 1_000);
    expect(await balance(id)).toEqual({ currentCents: null, forecastCents: null });
  });

  it('compte WITH_INTEREST : solde comme NORMAL', async () => {
    const id = await newAccount({ trackingType: 'WITH_INTEREST', openingBalance: { amountCents: 5_000, date: '2026-01-01' } });
    expect(await balance(id)).toEqual({ currentCents: 5_000, forecastCents: 5_000 });
  });

  it('sans `today` : jour du serveur', async () => {
    const id = await newAccount();
    await add(id, '2000-01-01', 100, 'CREDIT');
    await add(id, '2999-12-31', 30);
    expect(await balance(id, null)).toEqual({ currentCents: 100, forecastCents: 70 });
  });

  it('compte supprimé ⇒ 404 ; restauré ⇒ solde de retour', async () => {
    const id = await newAccount({ openingBalance: { amountCents: 100, date: '2026-01-01' } });
    await a.call('delete', `/api/v1/accounts/${id}`).expect(204);
    await a.call('get', `/api/v1/accounts/${id}/balance`).expect(404);
    await a.call('post', `/api/v1/accounts/${id}/restore`).expect(200);
    expect(await balance(id)).toEqual({ currentCents: 100, forecastCents: 100 });
  });

  it.each([
    ['today invalide', 'today=2026-02-30'],
    ['today au mauvais format', 'today=15/06/2026'],
    ['paramètre inconnu', 'foo=1'],
  ])('%s ⇒ 400', async (_, query) => {
    await a.call('get', `/api/v1/accounts/${await newAccount()}/balance?${query}`).expect(400);
  });

  it('id non UUID ⇒ 400 ; compte inexistant ⇒ 404', async () => {
    await a.call('get', '/api/v1/accounts/pas-un-uuid/balance').expect(400);
    await a.call('get', '/api/v1/accounts/00000000-0000-4000-8000-000000000000/balance').expect(404);
  });

  it('EXPLAIN : le SUM passe par l’index (accountId, date)', async () => {
    // Distribution réaliste : un utilisateur, plusieurs comptes ⇒ accountId plus sélectif que userId.
    const accounts = await prisma.account.createManyAndReturn({ data: Array.from({ length: 10 }, () => ({ userId: a.id, name: 'Compte', trackingType: 'NORMAL' as const })) });
    const ids = accounts.map((acc) => acc.id);
    await prisma.transaction.createMany({
      data: ids.flatMap((accountId) =>
        Array.from({ length: 200 }, (_, i) => ({
          userId: a.id,
          accountId,
          categoryId: groceries,
          name: '',
          date: new Date(Date.UTC(2026, 0, 1 + (i % 365))),
          amountCents: BigInt(100 + i),
          type: 'DEBIT' as const,
        })),
      ),
    });
    await prisma.$executeRaw`ANALYZE "Transaction"`;
    const id = ids[0];
    // Table de test trop petite pour que le planificateur renonce au seq scan : on le lui interdit.
    const [, plan] = await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL enable_seqscan = off`,
      prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${balanceSql(a.id, id, TODAY)}`),
    ]);
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('Transaction_accountId_date_idx');
  });
});
