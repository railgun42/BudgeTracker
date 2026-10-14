import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { rowCounts } from '../helpers/row-counts';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E34 — plancher et enveloppe dépensable, puis suivi d'une simulation sauvegardée avec les vraies dépenses.
// Exemple du PLAN : 500 € projetés dans 3 mois (31/01 → 30/04), plancher 200 € ⇒ 100 €/mois ;
// 50 € dépensés le 1er mois ⇒ 50 € restants, puis 125 €/mois. Cas de calcul : src/simulations/engine/allowance.spec.ts.
describe('Enveloppe dépensable (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  let recurrenceId: string;
  let simulationId: string;
  const params = () => ({ accountIds: [accountId], endDate: '2026-04-30', floor: { floorCents: 20_000, period: 'MONTH' } });
  const result = (today: string) => a.call('get', `/api/v1/cashflow-simulations/${simulationId}/result?today=${today}`);
  const spend = (amountCents: number, date: string, extra: object = {}) =>
    a.call('post', '/api/v1/transactions').send({ accountId, name: 'Dépense', amountCents, date, ...extra }).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    users = await createTwoUsers(app);
    a = users.a;
    // 530 € au 01/01, abonnement de 10 € le 5 de chaque mois dès février : 500 € projetés au 30/04.
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL', openingBalance: { amountCents: 53_000, date: '2026-01-01' } }).expect(201))
      .body.id;
    recurrenceId = (
      await a
        .call('post', '/api/v1/recurrences')
        .send({ accountId, interval: 1, unit: 'MONTH', startDate: '2026-02-05', template: { name: 'Abonnement', amountCents: 1_000, type: 'DEBIT' } })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('simulation directe avec plancher : enveloppe par mois ou par semaine', async () => {
    const simulate = (floor: object) => a.call('post', '/api/v1/simulations/cashflow').send({ ...params(), floor, today: '2026-01-31' }).expect(200);
    const { body } = await simulate({ floorCents: 20_000, period: 'MONTH' });
    expect(body.endBalanceCents).toBe(50_000);
    expect(body.allowance).toEqual({
      floorCents: 20_000,
      period: 'MONTH',
      periods: 3,
      current: { index: 0, from: '2026-02-01', to: '2026-02-28' },
      periodCents: 10_000,
      spentCents: 0,
      remainingCents: 10_000,
      belowFloor: false,
    });
    // 89 jours = 12 semaines + 5 jours : 300 € × 7 / (12 × 7 + 5).
    expect((await simulate({ floorCents: 20_000, period: 'WEEK' })).body.allowance).toMatchObject({ periods: 13, periodCents: Math.floor((30_000 * 7) / 89) });
    // Plancher au-dessus du solde projeté : enveloppe 0 et alerte.
    expect((await simulate({ floorCents: 60_000, period: 'MONTH' })).body.allowance).toMatchObject({ periodCents: 0, belowFloor: true });
    // Sans plancher : pas d'enveloppe.
    const { body: plain } = await a.call('post', '/api/v1/simulations/cashflow').send({ ...params(), floor: undefined, today: '2026-01-31' }).expect(200);
    expect(plain).not.toHaveProperty('allowance');
  });

  it.each([
    ['fin = début', { endDate: '2026-01-31' }],
    ['période inconnue', { floor: { floorCents: 0, period: 'DAY' } }],
    ['plancher décimal', { floor: { floorCents: 1.5, period: 'MONTH' } }],
    ['plancher manquant', { floor: { period: 'MONTH' } }],
    ['champ inconnu', { floor: { floorCents: 0, period: 'MONTH', perPeriodCents: 1 } }],
  ])('plancher : %s ⇒ 400', async (_, patch) => {
    await a.call('post', '/api/v1/simulations/cashflow').send({ ...params(), ...patch, today: '2026-01-31' }).expect(400);
  });

  it('sauvegarde : paramètres validés, date de début figée à today', async () => {
    const before = await rowCounts(prisma, a.id);
    const { body } = await a.call('post', '/api/v1/cashflow-simulations').send({ name: '  Printemps ', params: params(), today: '2026-01-31' }).expect(201);
    expect(body).toEqual({ id: expect.any(String), name: 'Printemps', params: { ...params(), startDate: '2026-01-31' }, version: 1 });
    expect(await rowCounts(prisma, a.id)).toEqual({ ...before, CashflowSimulation: before.CashflowSimulation + 1 });
    simulationId = body.id;
    expect((await a.call('get', '/api/v1/cashflow-simulations').expect(200)).body).toEqual([body]);
    expect((await a.call('get', `/api/v1/cashflow-simulations/${simulationId}`).expect(200)).body).toEqual(body);
  });

  it('suivi dans le temps : dépenses réelles déduites, reliquat réparti sur les périodes restantes', async () => {
    expect((await result('2026-01-31').expect(200)).body.allowance).toMatchObject({ periodCents: 10_000, spentCents: 0, remainingCents: 10_000 });

    // 50 € dépensés en février (sans catégorie) : il en reste 50. Les occurrences de l'abonnement ne sont pas des dépenses ponctuelles.
    await spend(5_000, '2026-02-10');
    const before = await rowCounts(prisma, a.id);
    const feb = (await result('2026-02-15').expect(200)).body;
    expect(await rowCounts(prisma, a.id)).toEqual(before); // relecture : rien n'est écrit
    expect(feb.startDate).toBe('2026-02-15');
    expect(feb.endBalanceCents).toBe(45_000);
    expect(feb.allowance).toMatchObject({ current: { index: 0, from: '2026-02-01', to: '2026-02-28' }, periodCents: 10_000, spentCents: 5_000, remainingCents: 5_000 });

    // Mars : les 50 € non dépensés se répartissent sur mars et avril.
    expect((await result('2026-03-01').expect(200)).body.allowance).toMatchObject({ current: { index: 1 }, periodCents: 12_500, spentCents: 0, remainingCents: 12_500 });

    // Dépense catégorisée, déjà passée, et dépense future du mois déjà saisie : toutes deux déduites de mars.
    const [category] = (await a.call('get', '/api/v1/categories').expect(200)).body as { id: string }[];
    await spend(2_000, '2026-03-03', { categoryId: category.id });
    await spend(1_000, '2026-03-25');
    // Ni un revenu ni une dépense d'avril ne sont des dépenses de mars.
    await a.call('post', '/api/v1/transactions').send({ accountId, name: 'Remboursement', amountCents: 500, date: '2026-03-10', type: 'CREDIT' }).expect(201);
    await spend(700, '2026-04-02');
    expect((await result('2026-03-15').expect(200)).body.allowance).toMatchObject({
      current: { index: 1, from: '2026-03-01', to: '2026-03-31' },
      // 500 − 50 − 20 − 10 + 5 − 7 − 200 + 30 (dépenses de mars) = 248 € pour mars et avril.
      periodCents: 12_400,
      spentCents: 3_000,
      remainingCents: 9_400,
    });

    // Dernier jour : avril reçoit tout ce qui reste, soit les 248 € moins les 30 € dépensés en mars.
    expect((await result('2026-04-30').expect(200)).body.allowance).toMatchObject({ current: { index: 2 }, periodCents: 22_500, spentCents: 700, remainingCents: 21_800 });
  });

  it('simulation terminée ⇒ 422 ; pas encore commencée ⇒ première période', async () => {
    await result('2026-05-01').expect(422);
    expect((await result('2026-01-10').expect(200)).body.allowance).toMatchObject({ current: { index: 0, from: '2026-02-01' } });
  });

  it('modification versionnée : 409 sur version périmée, paramètres revalidés', async () => {
    const patch = (body: object) => a.call('patch', `/api/v1/cashflow-simulations/${simulationId}`).send(body);
    const { body } = await patch({ version: 1, name: 'Printemps 2026' }).expect(200);
    expect(body).toMatchObject({ name: 'Printemps 2026', version: 2, params: { startDate: '2026-01-31' } });
    await patch({ version: 1, name: 'Périmé' }).expect(409);
    await patch({ version: 2, params: { ...params(), startDate: '2026-01-30' }, today: '2026-01-31' }).expect(400); // début passé
    await patch({ version: 2, params: { ...params(), accountIds: ['00000000-0000-4000-8000-000000000000'] }, today: '2026-01-31' }).expect(404);
    await patch({ version: 2, params: { ...params(), floor: { floorCents: 0, period: 'YEAR' } } }).expect(400);
    expect((await a.call('get', `/api/v1/cashflow-simulations/${simulationId}`).expect(200)).body).toEqual(body);
  });

  it('récurrence décochée puis supprimée : la simulation reste lisible', async () => {
    const { body } = await a
      .call('post', '/api/v1/cashflow-simulations')
      .send({ name: 'Sans abonnement', params: { ...params(), excludedRecurrenceIds: [recurrenceId] }, today: '2026-01-31' })
      .expect(201);
    await a.call('delete', `/api/v1/recurrences/${recurrenceId}`).expect(204);
    await a.call('get', `/api/v1/cashflow-simulations/${body.id}/result?today=2026-02-01`).expect(200);
    await a.call('delete', `/api/v1/cashflow-simulations/${body.id}`).expect(204);
    await a.call('get', `/api/v1/cashflow-simulations/${body.id}`).expect(404);
    await a.call('delete', `/api/v1/cashflow-simulations/${body.id}`).expect(404);
  });

  it.each([
    ['nom vide', { name: ' ', params: { endDate: '2026-04-30' } }],
    ['paramètres manquants', { name: 'x' }],
    ['champ inconnu', { name: 'x', params: { endDate: '2026-04-30' }, allowance: {} }],
  ])('sauvegarde : %s ⇒ 400', async (_, body) => {
    await a.call('post', '/api/v1/cashflow-simulations').send(body).expect(400);
  });

  it('sans session ⇒ 401 (CSRF valide)', async () => {
    await request(app.getHttpServer()).get('/api/v1/cashflow-simulations').expect(401);
    await request(app.getHttpServer()).post('/api/v1/cashflow-simulations').set('Cookie', 'csrf_token=t').set('X-CSRF-Token', 't').send({}).expect(401);
  });
});
