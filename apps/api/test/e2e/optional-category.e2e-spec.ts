import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed, SYSTEM_CATEGORIES } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E31 — catégorie puis sous-catégorie, toutes deux facultatives (SPEC §3.2, §7).
describe('Catégorie et sous-catégorie facultatives (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  const cat: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    for (const key of ['sport', 'sport.license', 'groceries', 'groceries.food', 'opening_balance'])
      cat[key] = (await prisma.category.findUniqueOrThrow({ where: { nameKey: key } })).id;
    users = await createTwoUsers(app);
    a = users.a;
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const create = (body: object) => a.call('post', '/api/v1/transactions').send({ accountId, amountCents: 1000, date: '2026-05-01', ...body });

  it('seed : catégories générales puis sous-catégories précises, anciennes clés conservées', async () => {
    const rows = await prisma.category.findMany({ where: { userId: null }, include: { parent: true } });
    const keys = new Map(rows.map((c) => [c.nameKey, c.parent?.nameKey ?? null]));
    for (const [root, children] of Object.entries(SYSTEM_CATEGORIES)) {
      expect(keys.get(root)).toBeNull();
      for (const child of children) expect(keys.get(`${root}.${child}`)).toBe(root);
    }
    // Jeu d'avant E31 : toujours présent, donc les transactions qui le référencent ne perdent rien.
    for (const old of ['entertainment.multimedia', 'entertainment.outings', 'sport.subscription', 'sport.equipment', 'groceries.food', 'groceries.hygiene', 'housing.rent', 'housing.utilities'])
      expect(keys.has(old)).toBe(true);
  });

  it('création sans catégorie ⇒ 201, categoryId null', async () => {
    const { body } = await create({}).expect(201);
    expect(body.categoryId).toBeNull();
    await create({ categoryId: null, subcategoryId: null }).expect(201);
  });

  it('catégorie seule, puis catégorie + sous-catégorie : la plus précise est stockée', async () => {
    expect((await create({ categoryId: cat.sport }).expect(201)).body.categoryId).toBe(cat.sport);
    expect((await create({ categoryId: cat.sport, subcategoryId: cat['sport.license'] }).expect(201)).body.categoryId).toBe(cat['sport.license']);
  });

  it('sous-catégorie qui n’appartient pas à la catégorie choisie, ou sans catégorie ⇒ 422', async () => {
    await create({ categoryId: cat.groceries, subcategoryId: cat['sport.license'] }).expect(422);
    await create({ subcategoryId: cat['sport.license'] }).expect(422);
    // Une racine n'est pas une sous-catégorie.
    await create({ categoryId: cat.sport, subcategoryId: cat.groceries }).expect(422);
    await create({ categoryId: 'pas-un-uuid' }).expect(400);
  });

  it('sous-catégorie perso sous une catégorie système ; celle de B ⇒ 404 pour A', async () => {
    const mine = (await a.call('post', '/api/v1/categories').send({ name: 'Escalade', parentId: cat.sport }).expect(201)).body.id;
    expect((await create({ categoryId: cat.sport, subcategoryId: mine }).expect(201)).body.categoryId).toBe(mine);
    const ofB = (await users.b.call('post', '/api/v1/categories').send({ name: 'Natation', parentId: cat.sport }).expect(201)).body.id;
    await create({ categoryId: cat.sport, subcategoryId: ofB }).expect(404);
  });

  it('PATCH : catégorie effaçable (null), sous-catégorie seule refusée, absente ⇒ inchangée', async () => {
    const { body: t } = await create({ categoryId: cat.groceries, subcategoryId: cat['groceries.food'] }).expect(201);
    const patch = (body: object) => a.call('patch', `/api/v1/transactions/${t.id}`).send(body);
    const v2 = (await patch({ version: 1, amountCents: 2000 }).expect(200)).body;
    expect(v2.categoryId).toBe(cat['groceries.food']);
    await patch({ version: 2, subcategoryId: cat['sport.license'] }).expect(422);
    expect((await patch({ version: 2, categoryId: cat.sport, subcategoryId: cat['sport.license'] }).expect(200)).body.categoryId).toBe(cat['sport.license']);
    expect((await patch({ version: 3, categoryId: null }).expect(200)).body.categoryId).toBeNull();
  });

  it('historique : filtre « sans catégorie » (categoryId=none)', async () => {
    const { b } = users;
    const own = (await b.call('post', '/api/v1/accounts').send({ name: 'B', trackingType: 'NORMAL' }).expect(201)).body.id;
    const add = (body: object) => b.call('post', '/api/v1/transactions').send({ accountId: own, amountCents: 500, date: '2026-04-01', ...body }).expect(201);
    const none = (await add({})).body.id;
    await add({ categoryId: cat.sport });
    const { body } = await b.call('get', '/api/v1/transactions?categoryId=none').expect(200);
    expect(body.items.map((t: { id: string }) => t.id)).toEqual([none]);
    expect((await b.call('get', `/api/v1/transactions?categoryId=${cat.sport}`).expect(200)).body.items).toHaveLength(1);
    await b.call('get', '/api/v1/transactions?categoryId=autre').expect(400);
  });

  it('stats : « Sans catégorie » regroupé en une ligne aux totaux exacts, solde de départ toujours exclu', async () => {
    const c = await createTwoUsers(app);
    try {
      const acc = (await c.a.call('post', '/api/v1/accounts').send({ name: 'S', trackingType: 'NORMAL', openingBalance: { amountCents: 50_000, date: '2026-01-01' } }).expect(201)).body.id;
      const add = (amountCents: number, body: object = {}) =>
        c.a.call('post', '/api/v1/transactions').send({ accountId: acc, amountCents, date: '2026-01-10', ...body }).expect(201);
      await add(1_234);
      await add(4_321);
      await add(10_000, { type: 'CREDIT' });
      await add(700, { categoryId: cat.groceries, subcategoryId: cat['groceries.food'] });
      const { body } = await c.a.call('get', '/api/v1/stats/by-category').expect(200);
      expect(body).toEqual([
        { categoryId: null, incomeCents: 10_000, expenseCents: 5_555 },
        { categoryId: cat['groceries.food'], incomeCents: 0, expenseCents: 700 },
      ]);
      expect((await c.a.call('get', '/api/v1/stats/monthly').expect(200)).body).toEqual([{ month: '2026-01', incomeCents: 10_000, expenseCents: 6_255 }]);
      // Rythme de la projection : les dépenses sans catégorie comptent, le solde de départ non.
      const { body: p } = await c.a.call('get', `/api/v1/simulations/projection?accountId=${acc}&months=1&windowMonths=1&today=2026-01-31`).expect(200);
      expect(p.averageMonthlySpendCents).toBe(6_255);
    } finally {
      await c.cleanup();
    }
  });

  it('solde : une transaction sans catégorie le jour du solde de départ suit le choix explicite', async () => {
    const acc = (await a.call('post', '/api/v1/accounts').send({ name: 'J', trackingType: 'NORMAL', openingBalance: { amountCents: 10_000, date: '2026-02-01' } }).expect(201)).body.id;
    const add = (countInBalance: boolean) =>
      a.call('post', '/api/v1/transactions').send({ accountId: acc, amountCents: 100, date: '2026-02-01', countInBalance }).expect(201);
    await add(false);
    await add(true);
    const { body } = await a.call('get', `/api/v1/accounts/${acc}/balance?today=2026-03-01`).expect(200);
    expect(body.currentCents).toBe(10_000 - 100);
  });

  it('récurrence : modèle sans catégorie, sous-catégorie vérifiée, catégorie effaçable', async () => {
    const rec = (template: object) =>
      a.call('post', '/api/v1/recurrences').send({ accountId, interval: 1, unit: 'MONTH', startDate: '2030-01-15', template: { amountCents: 900, ...template } });
    await rec({ categoryId: cat.groceries, subcategoryId: cat['sport.license'] }).expect(422);
    const { body: none } = await rec({}).expect(201);
    expect(none.template.categoryId).toBeNull();
    const { body: r } = await rec({ categoryId: cat.sport, subcategoryId: cat['sport.license'] }).expect(201);
    expect(r.template.categoryId).toBe(cat['sport.license']);
    const { body: cleared } = await a.call('patch', `/api/v1/recurrences/${r.id}`).send({ version: 1, template: { categoryId: null } }).expect(200);
    expect(cleared.template.categoryId).toBeNull();
    await a.call('patch', `/api/v1/recurrences/${r.id}`).send({ version: 2, template: { subcategoryId: cat['sport.license'] } }).expect(422);
  });

  it('récurrence sans catégorie : occurrences générées sans catégorie', async () => {
    const { body: r } = await a
      .call('post', '/api/v1/recurrences')
      .send({ accountId, interval: 1, unit: 'MONTH', startDate: '2020-01-31', endDate: '2020-03-31', template: { amountCents: 900 } })
      .expect(201);
    const rows = await prisma.transaction.findMany({ where: { recurrenceId: r.id }, select: { categoryId: true } });
    expect(rows).toEqual([{ categoryId: null }, { categoryId: null }, { categoryId: null }]);
  });
});
