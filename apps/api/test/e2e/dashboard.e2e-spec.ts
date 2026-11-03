import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { addDays } from '@budgetracker/shared';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { balanceDaysSql } from '../../src/balance/balance.service';
import { Prisma } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { todayUtc } from '../../src/recurrences/recurrences.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E42a — préférences, série de soldes, échéances. L'isolation A/B des routes est dans test/helpers/isolation-registry.ts.
describe('Tableau de bord (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let groceries: string;

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
  const add = async (accountId: string, date: string, amountCents: number, extra: object = {}) =>
    (await a.call('post', '/api/v1/transactions').send({ accountId, categoryId: groceries, amountCents, date, type: 'DEBIT', ...extra }).expect(201)).body.id as string;

  describe('GET /dashboard/balance-series', () => {
    const TODAY = '2026-03-10';
    let x: string;
    let y: string;
    let wallet: string;

    beforeAll(async () => {
      x = await newAccount({ openingBalance: { amountCents: 10_000, date: '2026-03-03' } });
      y = await newAccount();
      wallet = await newAccount({ trackingType: 'NOT_TRACKED' });
      await add(x, '2026-02-15', 700); // avant le solde de départ et avant la fenêtre : ignorée
      await add(x, '2026-03-01', 500); // avant le solde de départ, dans la fenêtre : ignorée
      await add(x, '2026-03-03', 1_000, { countInBalance: false }); // jour du solde de départ, non comptée
      await add(x, '2026-03-03', 200, { countInBalance: true });
      await add(x, '2026-03-05', 2_550, { type: 'CREDIT' });
      await add(x, '2026-03-20', 9_999); // après `to`
      const deleted = await add(x, '2026-03-07', 4_000);
      await a.call('delete', `/api/v1/transactions/${deleted}`).expect(204);
      await add(y, '2026-02-01', 5_000, { type: 'CREDIT' });
      await a.call('post', '/api/v1/transfers').send({ fromAccountId: x, toAccountId: y, amountCents: 300, date: '2026-03-06' }).expect(201);
      await add(wallet, '2026-03-04', 1_500);
    });

    const series = async (from: string, to = TODAY, ids = [x, y, wallet]) =>
      (await a.call('get', `/api/v1/dashboard/balance-series?from=${from}&to=${to}&accountIds=${ids.join(',')}`).expect(200)).body;

    it('solde de départ, countInBalance, virement, suppression : jour par jour ; NOT_TRACKED omis', async () => {
      const body = await series('2026-03-01');
      expect(body.dates).toHaveLength(10);
      expect(body.accounts).toEqual([
        { accountId: x, balancesCents: [0, 0, 9_800, 9_800, 12_350, 12_050, 12_050, 12_050, 12_050, 12_050] },
        { accountId: y, balancesCents: [5_000, 5_000, 5_000, 5_000, 5_000, 5_300, 5_300, 5_300, 5_300, 5_300] },
      ]);
      expect(body.totalCents.slice(4)).toEqual([17_350, 17_350, 17_350, 17_350, 17_350, 17_350]); // virement : total plat
    });

    it('le dernier point égale currentCents de /balance, pour chaque compte et pour le total', async () => {
      const body = await series('2026-03-01');
      const current = async (id: string) => (await a.call('get', `/api/v1/accounts/${id}/balance?today=${TODAY}`).expect(200)).body.currentCents as number;
      const [cx, cy] = [await current(x), await current(y)];
      expect(body.accounts.map((s: { balancesCents: number[] }) => s.balancesCents.at(-1))).toEqual([cx, cy]);
      expect(body.totalCents.at(-1)).toBe(cx + cy);
    });

    it('fenêtre après le solde de départ : le solde d’avant suit la même règle', async () => {
      expect((await series('2026-03-04', '2026-03-04')).totalCents).toEqual([9_800 + 5_000]);
    });

    it('sans accountIds : tous les comptes suivis de l’utilisateur', async () => {
      const { body } = await a.call('get', `/api/v1/dashboard/balance-series?from=${TODAY}&to=${TODAY}`).expect(200);
      const ids = body.accounts.map((s: { accountId: string }) => s.accountId);
      expect(ids).toEqual(expect.arrayContaining([x, y]));
      expect(ids).not.toContain(wallet);
    });

    it('bornes : from > to ou plus de 400 jours ⇒ 422 ; paramètres invalides ⇒ 400 ; compte inconnu ⇒ 404', async () => {
      const path = '/api/v1/dashboard/balance-series';
      await a.call('get', `${path}?from=2026-03-02&to=2026-03-01`).expect(422);
      await a.call('get', `${path}?from=2025-01-01&to=2026-02-05`).expect(422); // 401 jours
      await a.call('get', `${path}?from=2025-01-01&to=2026-02-04`).expect(200); // 400 jours
      await a.call('get', `${path}?from=2026-03-01`).expect(400);
      await a.call('get', `${path}?from=2026-02-30&to=2026-03-01`).expect(400);
      await a.call('get', `${path}?from=2026-03-01&to=2026-03-02&accountIds=pas-un-uuid`).expect(400);
      await a.call('get', `${path}?from=2026-03-01&to=2026-03-02&accountIds=${x},${x}`).expect(400);
      await a.call('get', `${path}?from=2026-03-01&to=2026-03-02&accountIds=${randomUUID()}`).expect(404);
    });

    it('compte supprimé ⇒ 404', async () => {
      const id = await newAccount();
      await a.call('delete', `/api/v1/accounts/${id}`).expect(204);
      await a.call('get', `/api/v1/dashboard/balance-series?from=${TODAY}&to=${TODAY}&accountIds=${id}`).expect(404);
    });

    it('EXPLAIN : la série passe par l’index (accountId, date)', async () => {
      // Comme pour le solde : plusieurs comptes ⇒ accountId plus sélectif que userId (données de B, à part).
      const { b } = users;
      const accounts = await prisma.account.createManyAndReturn({ data: Array.from({ length: 10 }, () => ({ userId: b.id, name: 'Compte', trackingType: 'NORMAL' as const })) });
      await prisma.transaction.createMany({
        data: accounts.flatMap(({ id: accountId }) =>
          Array.from({ length: 200 }, (_, i) => ({
            userId: b.id,
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
      const [, plan] = await prisma.$transaction([
        prisma.$executeRaw`SET LOCAL enable_seqscan = off`,
        prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${balanceDaysSql(b.id, accounts[0].id, '2026-03-01', TODAY)}`),
      ]);
      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('Transaction_accountId_date_idx');
    });
  });

  describe('GET et PUT /dashboard/preferences', () => {
    let pair: TwoUsers;
    let u: TestUser;
    beforeAll(async () => ((pair = await createTwoUsers(app)), (u = pair.a)));
    afterAll(() => pair?.cleanup());

    const prefs = { period: 'LAST_30_DAYS', accountIds: null, curveAccountIds: [], curveTotal: true, hiddenBlocks: [] };
    const put = (body: object) => u.call('put', '/api/v1/dashboard/preferences').send(body);
    const account = async () => (await u.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType: 'NORMAL' }).expect(201)).body.id as string;

    it('défauts (version 0), première écriture, verrou de version', async () => {
      expect((await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body).toEqual({
        period: 'THIS_MONTH',
        accountIds: null,
        curveAccountIds: [],
        curveTotal: true,
        hiddenBlocks: [],
        version: 0,
      });
      const id = await account();
      const first = { ...prefs, accountIds: [id], curveAccountIds: [id], curveTotal: false, hiddenBlocks: ['CATEGORY_DONUT', 'BALANCE_CURVE'] };
      expect((await put({ ...first, version: 0 }).expect(200)).body).toEqual({ ...first, version: 1 });
      await put({ ...prefs, version: 0 }).expect(409); // déjà créées
      expect((await put({ ...prefs, version: 1 }).expect(200)).body).toEqual({ ...prefs, version: 2 });
      await put({ ...first, version: 1 }).expect(409); // version périmée
      expect((await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body).toEqual({ ...prefs, version: 2 });
    });

    it('JSON invalide ⇒ 400, rien n’est écrit', async () => {
      const before = (await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body;
      const version = before.version as number;
      await u.call('put', '/api/v1/dashboard/preferences').set('Content-Type', 'application/json').send('{"period":').expect(400);
      for (const bad of [
        { period: 'TOMORROW' },
        { accountIds: Array.from({ length: 51 }, () => randomUUID()) },
        { curveAccountIds: Array.from({ length: 51 }, () => randomUUID()) },
        { accountIds: ['pas-un-uuid'] },
        { curveAccountIds: undefined },
        { hiddenBlocks: ['ALERTS'] },
        { hiddenBlocks: ['KEY_FIGURES', 'KEY_FIGURES'] },
        { curveTotal: 'oui' },
        { version: -1 },
        { extra: 1 },
      ])
        await put({ ...prefs, version, ...bad }).expect(400);
      expect((await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body).toEqual(before);
    });

    it('50 comptes acceptés ; compte inconnu ou supprimé ⇒ 404 ; compte supprimé ensuite ignoré à la lecture', async () => {
      const { version } = (await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body;
      await put({ ...prefs, version, accountIds: [randomUUID()] }).expect(404);
      const [kept, gone] = [await account(), await account()];
      const saved = (await put({ ...prefs, version, accountIds: [kept, gone], curveAccountIds: [gone] }).expect(200)).body;
      await u.call('delete', `/api/v1/accounts/${gone}`).expect(204);
      expect((await u.call('get', '/api/v1/dashboard/preferences').expect(200)).body).toMatchObject({ accountIds: [kept], curveAccountIds: [], version: saved.version });
      await put({ ...prefs, version: saved.version, curveAccountIds: [gone] }).expect(404);
      const many = await prisma.account.createManyAndReturn({ data: Array.from({ length: 50 }, () => ({ userId: u.id, name: 'Compte', trackingType: 'NORMAL' as const })) });
      await put({ ...prefs, version: saved.version, accountIds: many.map((m) => m.id) }).expect(200);
    });
  });

  describe('GET /dashboard/upcoming', () => {
    const today = todayUtc();
    let account: string;
    const recurrence = async (body: object) =>
      (
        await a
          .call('post', '/api/v1/recurrences')
          .send({ accountId: account, interval: 1, unit: 'DAY', startDate: today, template: { categoryId: groceries, amountCents: 1_000, name: 'Café' }, ...body })
          .expect(201)
      ).body.id as string;

    beforeAll(async () => (account = await newAccount()));

    it('occurrences de ]today, today + days], hors occurrences déjà générées ; supprimée ou finie ⇒ rien de plus', async () => {
      const daily = await recurrence({}); // l'occurrence du jour est générée à la création
      const ended = await recurrence({ startDate: addDays(today, 1), endDate: addDays(today, 1) });
      const deleted = await recurrence({});
      await a.call('delete', `/api/v1/recurrences/${deleted}`).expect(204);
      const { body } = await a.call('get', `/api/v1/dashboard/upcoming?today=${today}&days=3`).expect(200);
      const mine = body.filter((o: { recurrenceId: string }) => [daily, ended, deleted].includes(o.recurrenceId));
      expect(mine).toEqual([
        { recurrenceId: daily, accountId: account, date: addDays(today, 1), name: 'Café', amountCents: 1_000, type: 'DEBIT', categoryId: groceries },
        { recurrenceId: ended, accountId: account, date: addDays(today, 1), name: 'Café', amountCents: 1_000, type: 'DEBIT', categoryId: groceries },
        expect.objectContaining({ recurrenceId: daily, date: addDays(today, 2) }),
        expect.objectContaining({ recurrenceId: daily, date: addDays(today, 3) }),
      ]);
      // Défaut : 7 jours.
      const week = (await a.call('get', `/api/v1/dashboard/upcoming?today=${today}`).expect(200)).body.filter((o: { recurrenceId: string }) => o.recurrenceId === daily);
      expect(week.map((o: { date: string }) => o.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)));
    });

    it('days hors de 1..31 ou today invalide ⇒ 400', async () => {
      for (const q of ['days=0', 'days=32', 'days=1.5', 'today=2026-02-30']) await a.call('get', `/api/v1/dashboard/upcoming?${q}`).expect(400);
    });
  });
});
