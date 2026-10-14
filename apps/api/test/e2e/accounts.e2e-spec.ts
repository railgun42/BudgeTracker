import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E8 — comptes. L'isolation A/B de chaque route est dans test/helpers/isolation-registry.ts.
describe('Comptes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma); // catégorie système « opening_balance »
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const create = (body: object) => a.call('post', '/api/v1/accounts').send(body);
  const listIds = async () => (await a.call('get', '/api/v1/accounts').expect(200)).body.map((acc: { id: string }) => acc.id);

  it('crée les 3 trackingType, les liste et les relit', async () => {
    const created = [];
    for (const trackingType of ['NORMAL', 'NOT_TRACKED', 'WITH_INTEREST']) {
      const { body } = await create({ name: `  ${trackingType}  `, trackingType }).expect(201);
      expect(body).toEqual({ id: expect.any(String), name: trackingType, trackingType, openingDate: null, version: 1 });
      created.push(body);
    }
    expect(await listIds()).toEqual(expect.arrayContaining(created.map((c) => c.id)));
    for (const c of created) expect((await a.call('get', `/api/v1/accounts/${c.id}`).expect(200)).body).toEqual(c);
  });

  it('solde de départ ⇒ transaction « Solde de départ » (CREDIT si > 0, DEBIT si < 0)', async () => {
    const credit = await create({ name: 'Courant', trackingType: 'NORMAL', openingBalance: { amountCents: 123456, date: '2026-01-31' } }).expect(201);
    const debit = await create({ name: 'Découvert', trackingType: 'WITH_INTEREST', openingBalance: { amountCents: -500, date: '2026-02-01' } }).expect(201);
    const txs = await prisma.transaction.findMany({
      where: { accountId: { in: [credit.body.id, debit.body.id] } },
      include: { category: true },
      orderBy: { date: 'asc' },
    });
    expect(txs.map((t) => [t.accountId, t.userId, t.name, t.type, t.amountCents, t.date.toISOString().slice(0, 10), t.category?.nameKey])).toEqual([
      [credit.body.id, a.id, 'Solde de départ', 'CREDIT', 123456n, '2026-01-31', 'opening_balance'],
      [debit.body.id, a.id, 'Solde de départ', 'DEBIT', 500n, '2026-02-01', 'opening_balance'],
    ]);
  });

  it('sans solde de départ, aucune transaction', async () => {
    const { body } = await create({ name: 'Vide', trackingType: 'NORMAL' }).expect(201);
    expect(await prisma.transaction.count({ where: { accountId: body.id } })).toBe(0);
  });

  it('solde de départ refusé sur un compte NOT_TRACKED (422), rien n’est créé', async () => {
    const before = await prisma.account.count({ where: { userId: a.id } });
    await create({ name: 'Portefeuille', trackingType: 'NOT_TRACKED', openingBalance: { amountCents: 100, date: '2026-01-01' } }).expect(422);
    expect(await prisma.account.count({ where: { userId: a.id } })).toBe(before);
  });

  it.each([
    ['champ balance', { name: 'X', trackingType: 'NORMAL', balance: 100 }],
    ['trackingType inconnu', { name: 'X', trackingType: 'SAVINGS' }],
    ['nom vide', { name: '   ', trackingType: 'NORMAL' }],
    ['solde 0', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: 0, date: '2026-01-01' } }],
    ['solde décimal', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: 1.5, date: '2026-01-01' } }],
    ['solde en chaîne', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: '100', date: '2026-01-01' } }],
    ['date inexistante', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: 100, date: '2023-02-29' } }],
    ['date avec heure', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: 100, date: '2026-01-01T00:00:00Z' } }],
    ['champ inconnu dans le solde', { name: 'X', trackingType: 'NORMAL', openingBalance: { amountCents: 100, date: '2026-01-01', userId: 'x' } }],
  ])('création refusée (400) : %s', async (_, body) => {
    await create(body).expect(400);
  });

  it('PATCH versionné : bonne version ⇒ 200 et version + 1 ; version périmée ⇒ 409', async () => {
    const { body: acc } = await create({ name: 'Livret', trackingType: 'NORMAL' }).expect(201);
    const patch = (body: object) => a.call('patch', `/api/v1/accounts/${acc.id}`).send(body);

    const { body: updated } = await patch({ version: 1, name: 'Livret A', trackingType: 'WITH_INTEREST' }).expect(200);
    expect(updated).toEqual({ id: acc.id, name: 'Livret A', trackingType: 'WITH_INTEREST', openingDate: null, version: 2 });

    const conflict = await patch({ version: 1, name: 'Écrasé' }).expect(409);
    expect(conflict.body.statusCode).toBe(409);
    expect((await a.call('get', `/api/v1/accounts/${acc.id}`).expect(200)).body).toEqual(updated);

    await patch({ version: 2, balance: 0 }).expect(400);
    await patch({ name: 'Sans version' }).expect(400);
  });

  it('deux PATCH sur la même version : un 200, un 409', async () => {
    const { body: acc } = await create({ name: 'Concurrent', trackingType: 'NORMAL' }).expect(201);
    const results = await Promise.all(['Un', 'Deux'].map((name) => a.call('patch', `/api/v1/accounts/${acc.id}`).send({ version: 1, name })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('suppression logique : absent des listes, puis restauré', async () => {
    const { body: acc } = await create({ name: 'Éphémère', trackingType: 'NORMAL' }).expect(201);
    const url = `/api/v1/accounts/${acc.id}`;

    await a.call('delete', url).expect(204);
    expect(await listIds()).not.toContain(acc.id);
    await a.call('get', url).expect(404);
    await a.call('patch', url).send({ version: 2, name: 'Fantôme' }).expect(404);
    await a.call('delete', url).expect(404);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.id } })).deletedAt).not.toBeNull(); // logique, pas physique

    const { body: restored } = await a.call('post', `${url}/restore`).expect(200);
    expect(restored).toEqual({ ...acc, version: 3 });
    expect(await listIds()).toContain(acc.id);
    await a.call('post', `${url}/restore`).expect(404); // déjà actif
  });

  it('identifiant inconnu ⇒ 404, identifiant non UUID ⇒ 400', async () => {
    await a.call('get', '/api/v1/accounts/00000000-0000-4000-8000-000000000000').expect(404);
    await a.call('get', '/api/v1/accounts/pas-un-uuid').expect(400);
  });

  it('sans session ⇒ 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
  });
});
