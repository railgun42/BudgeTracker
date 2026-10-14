import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { rowCounts } from '../helpers/row-counts';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E27 — scénarios « et si » : CRUD versionné, application à une copie virtuelle, comparaison côte à côte.
// Calculs détaillés dans src/simulations/engine/scenario.spec.ts.
describe('Scénarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  let groceries: string;
  const compare = (ids: string[], extra = '') => a.call('get', `/api/v1/scenarios/compare?accountId=${accountId}&ids=${ids.join(',')}&months=3&today=2026-03-31${extra}`);
  const create = (body: object) => a.call('post', '/api/v1/scenarios').send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma); // catégorie système « groceries » (base vierge en CI)
    users = await createTwoUsers(app);
    a = users.a;

    const categories = (await a.call('get', '/api/v1/categories').expect(200)).body as { id: string; nameKey: string }[];
    const byKey = (key: string) => categories.find((c) => c.nameKey === key)!.id;
    groceries = byKey('groceries');
    // Solde de départ 1 000 € ; dépenses de la fenêtre ]31/12, 31/03] : 60 € (sous-catégorie) + 30 € de courses = 90 €.
    accountId = (
      await a
        .call('post', '/api/v1/accounts')
        .send({ name: 'Courant', trackingType: 'NORMAL', openingBalance: { amountCents: 100_000, date: '2026-01-01' } })
        .expect(201)
    ).body.id;
    const add = (categoryId: string, amountCents: number, date: string) =>
      a.call('post', '/api/v1/transactions').send({ accountId, categoryId, amountCents, date }).expect(201);
    await add(byKey('groceries.food'), 6_000, '2026-02-10');
    await add(groceries, 3_000, '2026-03-10');
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('CRUD : création, lecture, liste, 409 sur version périmée, suppression', async () => {
    const params = { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 1_299 }] };
    const { body } = await create({ name: '  Streaming  ', params }).expect(201);
    expect(body).toEqual({ id: expect.any(String), name: 'Streaming', params, version: 1 });
    expect((await a.call('get', `/api/v1/scenarios/${body.id}`).expect(200)).body).toEqual(body);
    expect((await a.call('get', '/api/v1/scenarios').expect(200)).body).toContainEqual(body);

    const loan = { changes: [{ kind: 'LOAN', principalCents: 100_000, annualRateBp: 0, months: 2 }] };
    const { body: updated } = await a.call('patch', `/api/v1/scenarios/${body.id}`).send({ version: 1, params: loan }).expect(200);
    expect(updated).toEqual({ ...body, params: loan, version: 2 });
    await a.call('patch', `/api/v1/scenarios/${body.id}`).send({ version: 1, name: 'Périmé' }).expect(409);

    await a.call('delete', `/api/v1/scenarios/${body.id}`).expect(204);
    await a.call('get', `/api/v1/scenarios/${body.id}`).expect(404);
    await a.call('delete', `/api/v1/scenarios/${body.id}`).expect(404);
  });

  it('comparer deux scénarios ⇒ la projection de base et deux séries ; aucune ligne écrite', async () => {
    const { body: frugal } = await create({ name: 'Courses −100 €', params: { changes: [{ kind: 'CATEGORY', categoryId: groceries, monthlyDeltaCents: -10_000 }] } }).expect(201);
    const { body: spender } = await create({
      name: 'Abonnement + crédit',
      params: {
        changes: [
          { kind: 'SUBSCRIPTION', monthlyCents: 1_500 },
          { kind: 'LOAN', principalCents: 100_000, annualRateBp: 0, months: 2 },
        ],
      },
    }).expect(201);

    const before = await rowCounts(prisma, a.id);
    const { body } = await compare([frugal.id, spender.id]).expect(200);
    expect(await rowCounts(prisma, a.id)).toEqual(before);
    expect((await a.call('get', `/api/v1/scenarios/${frugal.id}`).expect(200)).body).toEqual(frugal); // version inchangée

    // Base : 910 € au 31/03, rythme 30 €/mois.
    const series = (balances: number[]) => ({
      averageMonthlySpendCents: 3_000,
      points: ['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'].map((date, i) => ({ date, balanceCents: balances[i] })),
    });
    expect(body).toEqual({
      baseline: series([91_000, 88_000, 85_000, 82_000]),
      scenarios: [
        // −100 € plafonné aux 30 €/mois réellement dépensés en courses (sous-catégories comprises).
        { id: frugal.id, name: 'Courses −100 €', projection: series([91_000, 91_000, 91_000, 91_000]) },
        // −15 € d'abonnement chaque mois, −500 € de mensualité les deux premiers mois.
        { id: spender.id, name: 'Abonnement + crédit', projection: series([91_000, 36_500, -18_000, -22_500]) },
      ],
    });
    // L'ordre des séries suit `ids`.
    expect((await compare([spender.id, frugal.id]).expect(200)).body.scenarios.map((s: { id: string }) => s.id)).toEqual([spender.id, frugal.id]);
  });

  it('compte inconnu ⇒ 404, portefeuille ⇒ 422, scénario inconnu ⇒ 404', async () => {
    const { body } = await create({ name: 'S', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 100 }] } }).expect(201);
    await a.call('get', `/api/v1/scenarios/compare?accountId=00000000-0000-4000-8000-000000000000&ids=${body.id}&months=3`).expect(404);
    const wallet = (await a.call('post', '/api/v1/accounts').send({ name: 'Portefeuille', trackingType: 'NOT_TRACKED' }).expect(201)).body.id;
    await a.call('get', `/api/v1/scenarios/compare?accountId=${wallet}&ids=${body.id}&months=3`).expect(422);
    await compare([body.id, '00000000-0000-4000-8000-000000000000']).expect(404);
    await create({ name: 'S', params: { changes: [{ kind: 'CATEGORY', categoryId: '00000000-0000-4000-8000-000000000000', monthlyDeltaCents: -100 }] } }).expect(404);
  });

  const change = (c: object) => ({ name: 'S', params: { changes: [c] } });
  it.each([
    ['nom vide', { name: '  ', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 100 }] } }],
    ['params absents', { name: 'S' }],
    ['aucune modification', { name: 'S', params: { changes: [] } }],
    ['11 modifications', { name: 'S', params: { changes: Array(11).fill({ kind: 'SUBSCRIPTION', monthlyCents: 100 }) } }],
    ['params en texte', { name: 'S', params: '{"changes":[]}' }],
    ['modification non objet', { name: 'S', params: { changes: [42] } }],
    ['kind inconnu', change({ kind: 'LOTTERY', monthlyCents: 100 })],
    ['kind absent', change({ monthlyCents: 100 })],
    ['champ étranger au type', change({ kind: 'SUBSCRIPTION', monthlyCents: 100, categoryId: '00000000-0000-4000-8000-000000000000' })],
    ['champ inconnu dans params', { name: 'S', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 100 }], accountId: 'x' } }],
    ['abonnement nul', change({ kind: 'SUBSCRIPTION', monthlyCents: 0 })],
    ['abonnement décimal', change({ kind: 'SUBSCRIPTION', monthlyCents: 12.5 })],
    ['abonnement en texte', change({ kind: 'SUBSCRIPTION', monthlyCents: '100' })],
    ['variation nulle', change({ kind: 'CATEGORY', categoryId: '00000000-0000-4000-8000-000000000000', monthlyDeltaCents: 0 })],
    ['catégorie non UUID', change({ kind: 'CATEGORY', categoryId: 'x', monthlyDeltaCents: -100 })],
    ['prêt de 601 mois', change({ kind: 'LOAN', principalCents: 100_000, annualRateBp: 0, months: 601 })],
    ['prêt sans taux', change({ kind: 'LOAN', principalCents: 100_000, months: 12 })],
  ])('POST : %s ⇒ 400', async (_, body) => {
    await create(body).expect(400);
  });

  it('PATCH : paramètres invalides ⇒ 400, sans écriture', async () => {
    const { body } = await create(change({ kind: 'SUBSCRIPTION', monthlyCents: 100 })).expect(201);
    await a.call('patch', `/api/v1/scenarios/${body.id}`).send({ version: 1, params: { changes: [{ kind: 'LOTTERY' }] } }).expect(400);
    await a.call('patch', `/api/v1/scenarios/${body.id}`).send({ params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 1 }] } }).expect(400); // sans version
    expect((await a.call('get', `/api/v1/scenarios/${body.id}`).expect(200)).body).toEqual(body);
  });

  it.each([
    ['ids absents', ''],
    ['id non UUID', '&ids=x'],
    ['ids en double', '&ids=00000000-0000-4000-8000-000000000000,00000000-0000-4000-8000-000000000000'],
    ['6 scénarios', `&ids=${Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`).join(',')}`],
    ['horizon 0', '&ids=00000000-0000-4000-8000-000000000000&months=0'],
  ])('compare : %s ⇒ 400', async (_, query) => {
    const base = `/api/v1/scenarios/compare?accountId=${accountId}${query.includes('months') ? '' : '&months=3'}`;
    await a.call('get', base + query).expect(400);
  });
});
