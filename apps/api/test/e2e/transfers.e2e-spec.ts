import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E12 — virements. L'isolation A/B des routes est dans test/helpers/isolation-registry.ts.
describe('Virements (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let transferCategory: string;
  let cashCategory: string;
  const TODAY = '2026-06-15';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    transferCategory = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'transfer' } })).id;
    cashCategory = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'cash' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const newAccount = async (trackingType = 'NORMAL') =>
    (await a.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType }).expect(201)).body.id as string;
  const transfer = (body: object) => a.call('post', '/api/v1/transfers').send({ amountCents: 2_500, date: '2026-06-01', ...body });
  const balance = async (id: string) => (await a.call('get', `/api/v1/accounts/${id}/balance?today=${TODAY}`).expect(200)).body;
  const pair = async () => ({ from: await newAccount(), to: await newAccount() });

  it('créer ⇒ 2 lignes jumelées (DEBIT source, CREDIT cible) ; soldes −x / +x', async () => {
    const { from, to } = await pair();
    const { body } = await transfer({ fromAccountId: from, toAccountId: to, name: ' Épargne ', details: 'juin' }).expect(201);
    const leg = { name: 'Épargne', details: 'juin', date: '2026-06-01', amountCents: 2_500, categoryId: transferCategory, transferId: body.id, tagIds: [], recurrenceId: null, countInBalance: null, attachment: null, version: 1 };
    expect(body).toEqual({
      id: expect.any(String),
      version: 1,
      debit: { ...leg, id: expect.any(String), accountId: from, type: 'DEBIT' },
      credit: { ...leg, id: expect.any(String), accountId: to, type: 'CREDIT' },
    });
    expect(await prisma.transaction.count({ where: { transferId: body.id } })).toBe(2);
    expect(await balance(from)).toEqual({ currentCents: -2_500, forecastCents: -2_500 });
    expect(await balance(to)).toEqual({ currentCents: 2_500, forecastCents: 2_500 });
    expect((await a.call('get', `/api/v1/transfers/${body.id}`).expect(200)).body).toEqual(body);
    // Les jambes apparaissent dans l'historique comme des transactions ordinaires, marquées par transferId.
    expect((await a.call('get', `/api/v1/transactions/${body.debit.id}`).expect(200)).body).toEqual(body.debit);
  });

  it('PATCH : appliqué aux deux jambes, une seule version', async () => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    const { body: v2 } = await a.call('patch', `/api/v1/transfers/${t.id}`).send({ version: 1, amountCents: 999, date: '2026-07-01', name: 'Livret' }).expect(200);
    const changed = { amountCents: 999, date: '2026-07-01', name: 'Livret' };
    expect(v2).toEqual({ ...t, version: 2, debit: { ...t.debit, ...changed }, credit: { ...t.credit, ...changed } });
    expect(await balance(from)).toEqual({ currentCents: 0, forecastCents: -999 });
    expect(await balance(to)).toEqual({ currentCents: 0, forecastCents: 999 });
    await a.call('patch', `/api/v1/transfers/${t.id}`).send({ version: 1, amountCents: 1 }).expect(409);
    expect((await a.call('get', `/api/v1/transfers/${t.id}`).expect(200)).body).toEqual(v2);
  });

  it('deux PATCH concurrents sur la même version ⇒ un 200, un 409 ; les jambes restent identiques', async () => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    const results = await Promise.all(
      [111, 222].map((amountCents) => a.call('patch', `/api/v1/transfers/${t.id}`).send({ version: 1, amountCents }).then((res) => res)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.debit.amountCents;
    const { body } = await a.call('get', `/api/v1/transfers/${t.id}`).expect(200);
    expect(body.version).toBe(2);
    expect([body.debit.amountCents, body.credit.amountCents]).toEqual([winner, winner]);
  });

  it('jambe modifiée directement via /transactions ⇒ 422, rien d’écrit', async () => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    await a.call('patch', `/api/v1/transactions/${t.credit.id}`).send({ version: 1, amountCents: 1 }).expect(422);
    expect((await a.call('get', `/api/v1/transfers/${t.id}`).expect(200)).body).toEqual(t);
  });

  it('supprimer une jambe supprime les deux ; restaurer l’autre jambe restaure les deux', async () => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    await a.call('delete', `/api/v1/transactions/${t.debit.id}`).expect(204);
    await a.call('get', `/api/v1/transfers/${t.id}`).expect(404);
    await a.call('get', `/api/v1/transactions/${t.credit.id}`).expect(404);
    await a.call('delete', `/api/v1/transactions/${t.credit.id}`).expect(404);
    await a.call('patch', `/api/v1/transfers/${t.id}`).send({ version: 2, amountCents: 1 }).expect(404);
    expect(await balance(from)).toEqual({ currentCents: 0, forecastCents: 0 });
    expect(await balance(to)).toEqual({ currentCents: 0, forecastCents: 0 });
    expect(await prisma.transaction.count({ where: { transferId: t.id, deletedAt: { not: null } } })).toBe(2);

    await a.call('post', `/api/v1/transactions/${t.credit.id}/restore`).expect(200);
    expect((await a.call('get', `/api/v1/transfers/${t.id}`).expect(200)).body).toEqual({ ...t, version: 3 });
    expect(await balance(from)).toEqual({ currentCents: -2_500, forecastCents: -2_500 });
    await a.call('post', `/api/v1/transactions/${t.debit.id}/restore`).expect(404);
  });

  it('restauration refusée si un des deux comptes est supprimé (pas de virement à moitié visible)', async () => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    await a.call('delete', `/api/v1/transactions/${t.debit.id}`).expect(204);
    await a.call('delete', `/api/v1/accounts/${to}`).expect(204);
    await a.call('post', `/api/v1/transactions/${t.debit.id}/restore`).expect(404);
    await a.call('post', `/api/v1/accounts/${to}/restore`).expect(200);
    await a.call('post', `/api/v1/transactions/${t.debit.id}/restore`).expect(200);
  });

  it('vers un portefeuille NOT_TRACKED ⇒ 1 seule ligne DEBIT, catégorie Espèces, sans jumelage', async () => {
    const from = await newAccount();
    const wallet = await newAccount('NOT_TRACKED');
    const { body } = await transfer({ fromAccountId: from, toAccountId: wallet, name: 'Retrait' }).expect(201);
    expect(body).toEqual({
      id: null,
      version: null,
      credit: null,
      debit: expect.objectContaining({ accountId: from, type: 'DEBIT', categoryId: cashCategory, transferId: null, amountCents: 2_500, name: 'Retrait' }),
    });
    expect(await prisma.transaction.count({ where: { accountId: { in: [from, wallet] } } })).toBe(1);
    expect(await balance(from)).toEqual({ currentCents: -2_500, forecastCents: -2_500 });
    // Dépense ordinaire : modifiable directement.
    await a.call('patch', `/api/v1/transactions/${body.debit.id}`).send({ version: 1, amountCents: 2_000 }).expect(200);
  });

  it('source = cible ⇒ 422 ; source NOT_TRACKED ⇒ 422 ; compte inconnu ou supprimé ⇒ 404', async () => {
    const { from, to } = await pair();
    await transfer({ fromAccountId: from, toAccountId: from }).expect(422);
    await transfer({ fromAccountId: await newAccount('NOT_TRACKED'), toAccountId: to }).expect(422);
    await transfer({ fromAccountId: from, toAccountId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await a.call('delete', `/api/v1/accounts/${to}`).expect(204);
    await transfer({ fromAccountId: from, toAccountId: to }).expect(404);
    expect(await prisma.transaction.count({ where: { accountId: from } })).toBe(0);
  });

  it.each([
    ['montant nul', { amountCents: 0 }],
    ['montant décimal', { amountCents: 1.5 }],
    ['montant négatif', { amountCents: -100 }],
    ['date absente', { date: undefined }],
    ['date inexistante', { date: '2026-02-30' }],
    ['cible absente', { toAccountId: undefined }],
    ['champ inconnu', { categoryId: '00000000-0000-4000-8000-000000000000' }],
  ])('création refusée (400) : %s', async (_, body) => {
    const { from, to } = await pair();
    await transfer({ fromAccountId: from, toAccountId: to, ...body }).expect(400);
  });

  it.each([
    ['sans version', { amountCents: 1 }],
    ['montant nul', { version: 1, amountCents: 0 }],
    ['date null', { version: 1, date: null }],
    ['changement de compte', { version: 1, toAccountId: '00000000-0000-4000-8000-000000000000' }],
  ])('PATCH refusé (400) : %s', async (_, body) => {
    const { from, to } = await pair();
    const { body: t } = await transfer({ fromAccountId: from, toAccountId: to }).expect(201);
    await a.call('patch', `/api/v1/transfers/${t.id}`).send(body).expect(400);
  });

  it('identifiant inconnu ⇒ 404, non UUID ⇒ 400', async () => {
    await a.call('get', '/api/v1/transfers/00000000-0000-4000-8000-000000000000').expect(404);
    await a.call('get', '/api/v1/transfers/pas-un-uuid').expect(400);
  });
});
