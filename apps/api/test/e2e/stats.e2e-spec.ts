import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E24 — statistiques sur un jeu de données connu. L'isolation A/B des routes est aussi dans test/helpers/isolation-registry.ts.
describe('Statistiques (e2e)', () => {
  let app: INestApplication;
  let users: TwoUsers;
  let a: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    const prisma = app.get(PrismaService);
    await seed(prisma);
    for (const key of ['groceries.food', 'housing.rent', 'cash'])
      ids[key] = (await prisma.category.findUniqueOrThrow({ where: { nameKey: key } })).id;
    users = await createTwoUsers(app);
    a = users.a;

    const account = async (name: string, trackingType: string, body: object = {}) =>
      (await a.call('post', '/api/v1/accounts').send({ name, trackingType, ...body }).expect(201)).body.id as string;
    const add = async (accountId: string, date: string, amountCents: number, categoryId: string, type = 'DEBIT', tagIds: string[] = []) =>
      (await a.call('post', '/api/v1/transactions').send({ accountId, categoryId, amountCents, date, type, tagIds }).expect(201)).body;

    ids.salary = (await a.call('post', '/api/v1/categories').send({ name: 'Salaire' }).expect(201)).body.id;
    ids.t1 = (await a.call('post', '/api/v1/tags').send({ name: 'T1' }).expect(201)).body.id;
    ids.t2 = (await a.call('post', '/api/v1/tags').send({ name: 'T2' }).expect(201)).body.id;
    const [food, rent, salary] = [ids['groceries.food'], ids['housing.rent'], ids.salary];

    // Solde de départ : ni revenu ni dépense.
    ids.main = await account('Courant', 'NORMAL', { openingBalance: { amountCents: 100_000, date: '2026-01-01' } });
    ids.savings = await account('Livret', 'NORMAL');
    ids.wallet = await account('Portefeuille', 'NOT_TRACKED');

    await add(ids.main, '2026-01-05', 250_000, salary, 'CREDIT', [ids.t1]);
    await add(ids.main, '2026-01-10', 80_000, rent);
    await add(ids.main, '2026-01-20', 4_567, food, 'DEBIT', [ids.t1, ids.t2]);
    await add(ids.main, '2026-02-03', 1_233, food, 'DEBIT', [ids.t2]);
    await add(ids.main, '2026-02-05', 250_000, salary, 'CREDIT');
    // Virement interne : exclu ; retrait d'espèces : dépense « Espèces » ; puis achat au portefeuille (double comptage assumé).
    const send = (toAccountId: string, amountCents: number, date: string) =>
      a.call('post', '/api/v1/transfers').send({ fromAccountId: ids.main, toAccountId, amountCents, date }).expect(201);
    await send(ids.savings, 50_000, '2026-02-10');
    await send(ids.wallet, 6_000, '2026-02-12');
    await add(ids.wallet, '2026-02-13', 1_500, food);

    // Transaction supprimée logiquement : exclue.
    const deleted = await add(ids.main, '2026-03-01', 999, food);
    await a.call('delete', `/api/v1/transactions/${deleted.id}`).expect(204);
    // Compte supprimé : ses transactions sont exclues.
    ids.closed = await account('Clôturé', 'NORMAL');
    await add(ids.closed, '2026-03-02', 700, food);
    await a.call('delete', `/api/v1/accounts/${ids.closed}`).expect(204);
    // Compte devenu NOT_TRACKED après un CREDIT : dépenses seulement.
    const former = await account('Ancien', 'NORMAL');
    await add(former, '2026-03-03', 10_000, salary, 'CREDIT');
    await add(former, '2026-03-04', 300, food);
    await a.call('patch', `/api/v1/accounts/${former}`).send({ version: 1, trackingType: 'NOT_TRACKED' }).expect(200);

    // B : même catégorie système, mêmes mois ; jamais dans les agrégats de A.
    const { body: accountOfB } = await users.b.call('post', '/api/v1/accounts').send({ name: 'B', trackingType: 'NORMAL' }).expect(201);
    await users.b.call('post', '/api/v1/transactions').send({ accountId: accountOfB.id, categoryId: food, amountCents: 99_999, date: '2026-01-15' }).expect(201);
    ids.accountOfB = accountOfB.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const get = async (path: string, query = '') => (await a.call('get', `/api/v1/stats/${path}${query}`).expect(200)).body;

  it('par catégorie : totaux exacts au centime, dépenses décroissantes', async () => {
    expect(await get('by-category')).toEqual([
      { categoryId: ids['housing.rent'], incomeCents: 0, expenseCents: 80_000 },
      { categoryId: ids['groceries.food'], incomeCents: 0, expenseCents: 4_567 + 1_233 + 1_500 + 300 },
      { categoryId: ids.cash, incomeCents: 0, expenseCents: 6_000 }, // retrait d'espèces présent
      { categoryId: ids.salary, incomeCents: 500_000, expenseCents: 0 }, // CREDIT du compte devenu NOT_TRACKED absent
    ]);
  });

  it('mensuel : revenus/dépenses par mois, virement interne absent', async () => {
    expect(await get('monthly')).toEqual([
      { month: '2026-01', incomeCents: 250_000, expenseCents: 84_567 },
      { month: '2026-02', incomeCents: 250_000, expenseCents: 1_233 + 6_000 + 1_500 },
      { month: '2026-03', incomeCents: 0, expenseCents: 300 },
    ]);
  });

  it('par tag : une transaction à deux tags compte pour chacun', async () => {
    expect(await get('by-tag')).toEqual([
      { tagId: ids.t2, incomeCents: 0, expenseCents: 4_567 + 1_233 },
      { tagId: ids.t1, incomeCents: 250_000, expenseCents: 4_567 },
    ]);
  });

  it('par compte : ni la jambe de virement ni le solde de départ', async () => {
    expect(await get('by-category', `?accountId=${ids.main}`)).toEqual([
      { categoryId: ids['housing.rent'], incomeCents: 0, expenseCents: 80_000 },
      { categoryId: ids.cash, incomeCents: 0, expenseCents: 6_000 },
      { categoryId: ids['groceries.food'], incomeCents: 0, expenseCents: 5_800 },
      { categoryId: ids.salary, incomeCents: 500_000, expenseCents: 0 },
    ]);
    expect(await get('monthly', `?accountId=${ids.savings}`)).toEqual([]); // ne reçoit que le virement
    expect(await get('monthly', `?accountId=${ids.wallet}`)).toEqual([{ month: '2026-02', incomeCents: 0, expenseCents: 1_500 }]);
  });

  it('période : bornes inclusives', async () => {
    expect(await get('monthly', '?from=2026-02-03&to=2026-02-12')).toEqual([{ month: '2026-02', incomeCents: 250_000, expenseCents: 7_233 }]);
    expect(await get('by-tag', '?from=2026-01-21')).toEqual([{ tagId: ids.t2, incomeCents: 0, expenseCents: 1_233 }]);
    expect(await get('by-category', '?to=2026-01-05')).toEqual([{ categoryId: ids.salary, incomeCents: 250_000, expenseCents: 0 }]);
  });

  it('compte supprimé ou d’un autre utilisateur ⇒ 404', async () => {
    for (const path of ['by-category', 'by-tag', 'monthly']) {
      await a.call('get', `/api/v1/stats/${path}?accountId=${ids.closed}`).expect(404);
      await a.call('get', `/api/v1/stats/${path}?accountId=${ids.accountOfB}`).expect(404);
    }
  });

  it.each([
    ['from invalide', 'from=2026-02-30'],
    ['to au mauvais format', 'to=01/02/2026'],
    ['accountId non UUID', 'accountId=abc'],
    ['paramètre inconnu', 'foo=1'],
  ])('%s ⇒ 400', async (_, query) => {
    await a.call('get', `/api/v1/stats/monthly?${query}`).expect(400);
  });
});
