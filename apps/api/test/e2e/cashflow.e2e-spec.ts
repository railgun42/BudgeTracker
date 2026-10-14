import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { rowCounts } from '../helpers/row-counts';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E33 — simulation de trésorerie sur un jeu de données connu, au 31/03/2026 (paramètre `today`).
// Les cas de calcul sont détaillés dans src/simulations/engine/cashflow.spec.ts.
describe('Simulation de trésorerie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  const ids: Record<string, string> = {};
  const body = (patch: object = {}) => ({ accountIds: [ids.main], endDate: '2026-05-31', today: '2026-03-31', ...patch });
  const simulate = (patch: object = {}) => a.call('post', '/api/v1/simulations/cashflow').send(body(patch));
  const item = (patch: object) => ({ id: null, included: true, occurrences: 1, ...patch });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    users = await createTwoUsers(app);
    a = users.a;

    const account = async (name: string, trackingType: string, extra: object = {}) =>
      (await a.call('post', '/api/v1/accounts').send({ name, trackingType, ...extra }).expect(201)).body.id as string;
    const recurrence = async (name: string, startDate: string, amountCents: number, type: string) =>
      (
        await a
          .call('post', '/api/v1/recurrences')
          .send({ accountId: ids.main, interval: 1, unit: 'MONTH', startDate, template: { name, amountCents, type } })
          .expect(201)
      ).body.id as string;

    ids.main = await account('Courant', 'NORMAL', { openingBalance: { amountCents: 100_000, date: '2026-01-01' } });
    ids.savings = await account('Livret', 'NORMAL', { openingBalance: { amountCents: 50_000, date: '2026-01-01' } });
    ids.wallet = await account('Portefeuille', 'NOT_TRACKED');
    // Solde au 31/03 : 1 000 − 100 + 3 × 2 000 (28/01, 28/02, 28/03) − 3 × 700 (05/01, 05/02, 05/03) = 4 800 €.
    ids.rent = await recurrence('Loyer', '2026-01-05', 70_000, 'DEBIT');
    ids.salary = await recurrence('Salaire', '2026-01-28', 200_000, 'CREDIT');
    await a.call('post', '/api/v1/transactions').send({ accountId: ids.main, name: 'Courses', amountCents: 10_000, date: '2026-03-10' }).expect(201);
    // Futur déjà saisi : virement vers le livret le 10/04, dentiste le 20/04.
    await a.call('post', '/api/v1/transfers').send({ fromAccountId: ids.main, toAccountId: ids.savings, amountCents: 10_000, date: '2026-04-10' }).expect(201);
    ids.dentist = (
      await a.call('post', '/api/v1/transactions').send({ accountId: ids.main, name: 'Dentiste', amountCents: 5_000, date: '2026-04-20' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('solde au jour X : solde actuel + récurrences + transactions futures, détail de la période', async () => {
    const { body } = await simulate().expect(200);
    expect(body).toEqual({
      startDate: '2026-03-31',
      endDate: '2026-05-31',
      startBalanceCents: 480_000,
      endBalanceCents: 480_000 - 2 * 70_000 + 2 * 200_000 - 10_000 - 5_000,
      creditCents: 400_000,
      debitCents: 155_000,
      items: [
        item({ source: 'RECURRENCE', id: ids.rent, name: 'Loyer', type: 'DEBIT', amountCents: 70_000, occurrences: 2, totalCents: 140_000 }),
        item({ source: 'RECURRENCE', id: ids.salary, name: 'Salaire', type: 'CREDIT', amountCents: 200_000, occurrences: 2, totalCents: 400_000 }),
        item({ source: 'PLANNED', id: expect.any(String), name: '', type: 'DEBIT', amountCents: 10_000, totalCents: 10_000 }), // jambe du virement
        item({ source: 'PLANNED', id: ids.dentist, name: 'Dentiste', type: 'DEBIT', amountCents: 5_000, totalCents: 5_000 }),
      ],
      points: [
        { date: '2026-03-31', balanceCents: 480_000 },
        { date: '2026-04-05', balanceCents: 410_000 },
        { date: '2026-04-10', balanceCents: 400_000 },
        { date: '2026-04-20', balanceCents: 395_000 },
        { date: '2026-04-28', balanceCents: 595_000 },
        { date: '2026-05-05', balanceCents: 525_000 },
        { date: '2026-05-28', balanceCents: 725_000 },
        { date: '2026-05-31', balanceCents: 725_000 },
      ],
    });
  });

  it('récurrence décochée : hors solde, toujours détaillée', async () => {
    const { body } = await simulate({ excludedRecurrenceIds: [ids.rent] }).expect(200);
    expect(body.endBalanceCents).toBe(725_000 + 140_000);
    expect(body.items[0]).toEqual(item({ source: 'RECURRENCE', id: ids.rent, name: 'Loyer', type: 'DEBIT', amountCents: 70_000, included: false, occurrences: 2, totalCents: 140_000 }));
  });

  it('ponctuelles et récurrences propres à la simulation : comptées dans la simulation, rien n’est écrit', async () => {
    const before = await rowCounts(prisma, a.id);
    const { body } = await simulate({
      oneOffs: [{ name: '  Vacances ', type: 'DEBIT', amountCents: 120_000, date: '2026-05-15' }],
      extraRecurrences: [{ name: 'Sport', type: 'DEBIT', amountCents: 3_000, interval: 1, unit: 'MONTH', startDate: '2026-04-01' }],
    }).expect(200);
    expect(await rowCounts(prisma, a.id)).toEqual(before);
    expect(body.endBalanceCents).toBe(725_000 - 120_000 - 2 * 3_000);
    expect(body.items.slice(2, 4)).toEqual([
      item({ source: 'EXTRA_RECURRENCE', name: 'Sport', type: 'DEBIT', amountCents: 3_000, occurrences: 2, totalCents: 6_000 }),
      item({ source: 'ONE_OFF', name: 'Vacances', type: 'DEBIT', amountCents: 120_000, totalCents: 120_000 }),
    ]);
    // Rejouée sans elles : la ponctuelle n'existe nulle part ailleurs.
    expect((await simulate().expect(200)).body.endBalanceCents).toBe(725_000);
    expect((await a.call('get', '/api/v1/recurrences').expect(200)).body).toHaveLength(2);
  });

  it('date de début dans le futur : solde de départ projeté, détail limité à la période', async () => {
    const { body } = await simulate({ startDate: '2026-04-30' }).expect(200);
    // 4 800 − 700 (05/04) − 100 (10/04) − 50 (20/04) + 2 000 (28/04).
    expect(body.startBalanceCents).toBe(595_000);
    expect(body.endBalanceCents).toBe(725_000);
    expect(body.items.map((i: { id: string; occurrences: number }) => [i.id, i.occurrences])).toEqual([
      [ids.rent, 1],
      [ids.salary, 1],
    ]);
  });

  it('plusieurs comptes : soldes additionnés, virement entre eux neutre et absent du détail', async () => {
    const { body } = await simulate({ accountIds: [ids.main, ids.savings] }).expect(200);
    expect(body.startBalanceCents).toBe(480_000 + 50_000);
    expect(body.endBalanceCents).toBe(725_000 + 10_000 + 50_000);
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Loyer', 'Salaire', 'Dentiste']);
  });

  it('compte sans solde ⇒ 422 ; compte ou récurrence inconnus ⇒ 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await simulate({ accountIds: [ids.main, ids.wallet] }).expect(422);
    await simulate({ accountIds: [unknown] }).expect(404);
    await simulate({ excludedRecurrenceIds: [unknown] }).expect(404);
    // Récurrence existante mais sur un compte non simulé.
    await simulate({ accountIds: [ids.savings], excludedRecurrenceIds: [ids.rent] }).expect(404);
  });

  it.each([
    ['fin avant le début', { startDate: '2026-04-30', endDate: '2026-04-29' }],
    ['début dans le passé', { startDate: '2026-03-30' }],
    ['période au-delà de 600 mois', { endDate: '2076-04-01' }],
    ['comptes manquants', { accountIds: undefined }],
    ['aucun compte', { accountIds: [] }],
    ['compte en double', { accountIds: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'] }],
    ['date invalide', { endDate: '2026-02-30' }],
    ['champ inconnu', { balanceCents: 5 }],
    ['montant nul', { oneOffs: [{ name: 'x', type: 'DEBIT', amountCents: 0, date: '2026-04-01' }] }],
    ['montant décimal', { oneOffs: [{ name: 'x', type: 'DEBIT', amountCents: 1.5, date: '2026-04-01' }] }],
    ['type inconnu', { oneOffs: [{ name: 'x', type: 'TRANSFER', amountCents: 1, date: '2026-04-01' }] }],
    ['nom vide', { oneOffs: [{ name: '  ', type: 'DEBIT', amountCents: 1, date: '2026-04-01' }] }],
    ['unité inconnue', { extraRecurrences: [{ name: 'x', type: 'DEBIT', amountCents: 1, interval: 1, unit: 'HOUR', startDate: '2026-04-01' }] }],
    ['intervalle nul', { extraRecurrences: [{ name: 'x', type: 'DEBIT', amountCents: 1, interval: 0, unit: 'DAY', startDate: '2026-04-01' }] }],
  ])('%s ⇒ 400', async (_, patch) => {
    await simulate(patch).expect(400);
  });

  it('sans session ⇒ 401 (CSRF valide), sans CSRF ⇒ 403', async () => {
    const post = () => request(app.getHttpServer()).post('/api/v1/simulations/cashflow');
    await post().set('Cookie', 'csrf_token=t').set('X-CSRF-Token', 't').send(body()).expect(401);
    await post().send(body()).expect(403);
  });
});
