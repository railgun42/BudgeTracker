import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E30 — transactions antérieures au solde de départ : historique et stats oui, solde non (SPEC §3.3).
// Aucune route nouvelle : l'isolation reste couverte par test/helpers/isolation-registry.ts.
describe('Solde de départ et historique antérieur (e2e)', () => {
  let app: INestApplication;
  let users: TwoUsers;
  let a: TestUser;
  let groceries: string;
  const TODAY = '2026-06-15';
  const OPENING = '2026-03-01';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    const prisma = app.get(PrismaService);
    await seed(prisma);
    groceries = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'groceries' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  // Compte ouvert avec 1 000 € le 01/03.
  const newAccount = async (trackingType = 'NORMAL') =>
    (await a.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType, openingBalance: { amountCents: 100_000, date: OPENING } }).expect(201)).body
      .id as string;
  const add = (accountId: string, date: string, extra: object = {}) =>
    a.call('post', '/api/v1/transactions').send({ accountId, categoryId: groceries, amountCents: 1_000, date, ...extra });
  const balance = async (accountId: string) => (await a.call('get', `/api/v1/accounts/${accountId}/balance?today=${TODAY}`).expect(200)).body;
  const unchanged = { currentCents: 100_000, forecastCents: 100_000 };
  const opening = async (accountId: string) =>
    (await a.call('get', `/api/v1/transactions?accountId=${accountId}`).expect(200)).body.items.find((t: { name: string }) => t.name === 'Solde de départ');

  it('le compte expose la date du solde de départ', async () => {
    const id = await newAccount();
    expect((await a.call('get', `/api/v1/accounts/${id}`).expect(200)).body.openingDate).toBe(OPENING);
    const { body } = await a.call('post', '/api/v1/accounts').send({ name: 'Sans', trackingType: 'NORMAL' }).expect(201);
    expect(body.openingDate).toBeNull();
  });

  it('J−1 : solde actuel et prévisionnel inchangés, mais présente dans l’historique et les stats', async () => {
    const id = await newAccount();
    const { body: tx } = await add(id, '2026-02-28').expect(201);
    expect(tx.countInBalance).toBeNull();
    expect(await balance(id)).toEqual(unchanged);
    const history = (await a.call('get', `/api/v1/transactions?accountId=${id}`).expect(200)).body.items.map((t: { id: string }) => t.id);
    expect(history).toContain(tx.id);
    const stats = (await a.call('get', `/api/v1/stats/monthly?accountId=${id}`).expect(200)).body;
    expect(stats).toEqual([{ month: '2026-02', incomeCents: 0, expenseCents: 1_000 }]);
  });

  it('J+1 : solde modifié', async () => {
    const id = await newAccount();
    await add(id, '2026-03-02').expect(201);
    expect(await balance(id)).toEqual({ currentCents: 99_000, forecastCents: 99_000 });
  });

  it('jour J : sans choix ⇒ 400 ; comptée ou non selon la valeur', async () => {
    const id = await newAccount();
    await add(id, OPENING).expect(400);
    await add(id, OPENING, { countInBalance: 'oui' }).expect(400);
    await add(id, OPENING, { countInBalance: false }).expect(201);
    expect(await balance(id)).toEqual(unchanged);
    const { body } = await add(id, OPENING, { countInBalance: true }).expect(201);
    expect(body.countInBalance).toBe(true);
    expect(await balance(id)).toEqual({ currentCents: 99_000, forecastCents: 99_000 });
  });

  it('sans solde de départ : aucun choix exigé, tout compte', async () => {
    const { body } = await a.call('post', '/api/v1/accounts').send({ name: 'Sans', trackingType: 'NORMAL' }).expect(201);
    await add(body.id, '2020-01-01').expect(201);
    expect(await balance(body.id)).toEqual({ currentCents: -1_000, forecastCents: -1_000 });
  });

  it('PATCH : déplacer vers le jour J exige le choix ; éditer sans déplacer ne le redemande pas', async () => {
    const id = await newAccount();
    const { body: tx } = await add(id, '2026-04-01').expect(201);
    await a.call('patch', `/api/v1/transactions/${tx.id}`).send({ version: 1, date: OPENING }).expect(400);
    await a.call('patch', `/api/v1/transactions/${tx.id}`).send({ version: 1, date: OPENING, countInBalance: false }).expect(200);
    expect(await balance(id)).toEqual(unchanged);
    await a.call('patch', `/api/v1/transactions/${tx.id}`).send({ version: 2, date: OPENING, amountCents: 2_000 }).expect(200);
    await a.call('patch', `/api/v1/transactions/${tx.id}`).send({ version: 3, countInBalance: null }).expect(400);
    // Le solde de départ lui-même se modifie sans choix.
    const start = await opening(id);
    await a.call('patch', `/api/v1/transactions/${start.id}`).send({ version: start.version, amountCents: 50_000 }).expect(200);
  });

  it('date du solde de départ modifiée : la règle suit la nouvelle date', async () => {
    const id = await newAccount();
    await add(id, '2026-02-15').expect(201);
    expect(await balance(id)).toEqual(unchanged);
    const start = await opening(id);
    await a.call('patch', `/api/v1/transactions/${start.id}`).send({ version: start.version, date: '2026-02-01' }).expect(200);
    expect(await balance(id)).toEqual({ currentCents: 99_000, forecastCents: 99_000 });
    expect((await a.call('get', `/api/v1/accounts/${id}`).expect(200)).body.openingDate).toBe('2026-02-01');
  });

  it('solde de départ supprimé ⇒ tout compte ; restauré ⇒ la règle revient', async () => {
    const id = await newAccount();
    await add(id, '2026-02-15').expect(201);
    const start = await opening(id);
    await a.call('delete', `/api/v1/transactions/${start.id}`).expect(204);
    expect(await balance(id)).toEqual({ currentCents: -1_000, forecastCents: -1_000 });
    expect((await a.call('get', `/api/v1/accounts/${id}`).expect(200)).body.openingDate).toBeNull();
    await add(id, OPENING).expect(201); // plus de solde de départ ⇒ plus de choix exigé
    await a.call('post', `/api/v1/transactions/${start.id}/restore`).expect(200);
    // Jour J sans choix (posée pendant la suppression) : comptée.
    expect(await balance(id)).toEqual({ currentCents: 99_000, forecastCents: 99_000 });
  });

  it('virement : même règle jambe par jambe ; jour J d’un des comptes sans choix ⇒ 400', async () => {
    const from = await newAccount();
    const { body: plain } = await a.call('post', '/api/v1/accounts').send({ name: 'Sans', trackingType: 'NORMAL' }).expect(201);
    const transfer = (date: string, extra: object = {}) =>
      a.call('post', '/api/v1/transfers').send({ fromAccountId: from, toAccountId: plain.id, amountCents: 5_000, date, ...extra });
    // Antérieur au solde de départ de la source : débit hors solde, crédit compté sur la cible.
    const { body } = await transfer('2026-02-01').expect(201);
    expect(await balance(from)).toEqual(unchanged);
    expect(await balance(plain.id)).toEqual({ currentCents: 5_000, forecastCents: 5_000 });
    await transfer(OPENING).expect(400);
    await transfer(OPENING, { countInBalance: false }).expect(201);
    expect(await balance(from)).toEqual(unchanged);
    // PATCH vers le jour J : choix exigé, appliqué aux deux jambes.
    await a.call('patch', `/api/v1/transfers/${body.id}`).send({ version: body.version, date: OPENING }).expect(400);
    await a.call('patch', `/api/v1/transfers/${body.id}`).send({ version: body.version, date: OPENING, countInBalance: true }).expect(200);
    expect(await balance(from)).toEqual({ currentCents: 95_000, forecastCents: 95_000 });
  });
});
