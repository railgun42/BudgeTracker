import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays } from '@budgetracker/shared';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { PurgeJob } from '../../src/jobs/purge.job';
import { RecurrenceJob } from '../../src/jobs/recurrence.job';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecurrencesService, todayUtc } from '../../src/recurrences/recurrences.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E20 — récurrences. Horloge injectée (generate(…, today)) : les règles démarrent en 2030, rien n'est dû
// « aujourd'hui », et chaque test avance le jour à la main.
describe('Récurrences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RecurrencesService;
  let users: TwoUsers;
  let a: TestUser;
  let categoryId: string;
  let accountId: string;
  const TODAY = todayUtc();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(RecurrencesService);
    await seed(prisma);
    categoryId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'housing.rent' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const create = (body: object = {}, template: object = {}) =>
    a.call('post', '/api/v1/recurrences').send({ accountId, interval: 1, unit: 'MONTH', startDate: '2030-01-31', ...body, template: { categoryId, amountCents: 80_000, name: 'Loyer', ...template } });
  const occurrences = (recurrenceId: string) =>
    prisma.transaction.findMany({ where: { recurrenceId, deletedAt: null }, orderBy: { date: 'asc' }, select: { id: true, date: true, amountCents: true, version: true } });
  const dates = async (recurrenceId: string) => (await occurrences(recurrenceId)).map((t) => t.date.toISOString().slice(0, 10));
  // Récurrence quotidienne dont la génération s'est arrêtée il y a `daysAgo` jours (serveur arrêté, utilisateur absent).
  const lagging = async (daysAgo: number, amountCents = 500n) =>
    (
      await prisma.recurrence.create({
        data: {
          userId: a.id,
          accountId,
          interval: 1,
          unit: 'DAY',
          startDate: new Date(addDays(TODAY, -60)),
          anchorDay: 1,
          lastGeneration: new Date(addDays(TODAY, -daysAgo)),
          template: { create: { name: 'Café', amountCents, type: 'DEBIT', categoryId } },
        },
      })
    ).id;

  it('création : DTO renvoyé, rien de dû avant startDate', async () => {
    const { body } = await create({ endDate: '2030-12-31' }, { details: 'bail' }).expect(201);
    expect(body).toEqual({
      id: expect.any(String),
      accountId,
      interval: 1,
      unit: 'MONTH',
      startDate: '2030-01-31',
      endDate: '2030-12-31',
      template: { name: 'Loyer', amountCents: 80_000, type: 'DEBIT', categoryId, details: 'bail', tagIds: [] },
      version: 1,
    });
    expect(await dates(body.id)).toEqual([]);
    expect((await a.call('get', '/api/v1/recurrences').expect(200)).body).toContainEqual(body);
  });

  it('startDate passée ⇒ les occurrences dues jusqu’à aujourd’hui sont créées aussitôt, avec les tags du modèle', async () => {
    const tag = (await a.call('post', '/api/v1/tags').send({ name: `fixe-${Math.random()}` }).expect(201)).body.id;
    const { body } = await create({ unit: 'WEEK', startDate: addDays(TODAY, -14) }, { tagIds: [tag] }).expect(201);
    expect(await dates(body.id)).toEqual([addDays(TODAY, -14), addDays(TODAY, -7), TODAY]);
    const { body: page } = await a.call('get', `/api/v1/transactions?tagId=${tag}`).expect(200);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toMatchObject({ recurrenceId: body.id, amountCents: 80_000, name: 'Loyer', type: 'DEBIT', tagIds: [tag] });
  });

  it('critère clé SPEC §10 : 20 generate() simultanés ⇒ exactement N lignes ; 31 du mois sans dérive', async () => {
    const { body } = await create().expect(201);
    const counts = await Promise.all(Array.from({ length: 20 }, () => service.generate(a.id, body.id, '2031-01-15')));
    expect(counts.reduce((s, n) => s + n, 0)).toBe(12);
    expect(await dates(body.id)).toEqual([
      '2030-01-31', '2030-02-28', '2030-03-31', '2030-04-30', '2030-05-31', '2030-06-30',
      '2030-07-31', '2030-08-31', '2030-09-30', '2030-10-31', '2030-11-30', '2030-12-31',
    ]);
    expect(await service.generate(a.id, body.id, '2031-01-15')).toBe(0);
  });

  it('absent un mois ⇒ toutes les occurrences dues sont créées à la connexion', async () => {
    const id = await lagging(31);
    await app.get(AuthService).openSession(a.id);
    const got = await dates(id);
    expect(got).toHaveLength(31);
    expect([got[0], got.at(-1)]).toEqual([addDays(TODAY, -30), TODAY]);
    // Reconnexion le même jour : rien de plus.
    await app.get(AuthService).openSession(a.id);
    expect(await dates(id)).toHaveLength(31);
  });

  it('job quotidien : rattrape les récurrences en retard', async () => {
    const id = await lagging(3);
    await app.get(RecurrenceJob).handleCron();
    expect(await dates(id)).toEqual([addDays(TODAY, -2), addDays(TODAY, -1), TODAY]);
  });

  it('occurrence passée supprimée ⇒ jamais recréée, même après la purge des 30 jours', async () => {
    const { body } = await create().expect(201);
    await service.generate(a.id, body.id, '2030-03-31');
    const [, feb] = await occurrences(body.id);
    await a.call('delete', `/api/v1/transactions/${feb.id}`).expect(204);

    await service.generate(a.id, body.id, '2030-04-30');
    expect(await dates(body.id)).toEqual(['2030-01-31', '2030-03-31', '2030-04-30']);

    // Purge : la ligne disparaît, la contrainte unique ne protège plus la date ; lastGeneration si.
    await prisma.transaction.update({ where: { id: feb.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await app.get(PurgeJob).purge(new Date());
    expect(await prisma.transaction.count({ where: { id: feb.id } })).toBe(0);
    await service.generate(a.id, body.id, '2030-05-31');
    expect(await dates(body.id)).toEqual(['2030-01-31', '2030-03-31', '2030-04-30', '2030-05-31']);
  });

  it('occurrence éditée isolément : la règle continue, l’édition est conservée', async () => {
    const { body } = await create().expect(201);
    await service.generate(a.id, body.id, '2030-02-28');
    const [jan] = await occurrences(body.id);
    await a.call('patch', `/api/v1/transactions/${jan.id}`).send({ version: jan.version, amountCents: 1, date: '2030-02-02' }).expect(200);
    await service.generate(a.id, body.id, '2030-03-31');
    expect((await occurrences(body.id)).map((t) => [t.date.toISOString().slice(0, 10), Number(t.amountCents)])).toEqual([
      ['2030-02-02', 1],
      ['2030-02-28', 80_000],
      ['2030-03-31', 80_000],
    ]);
  });

  it('changer le montant ne modifie aucune transaction passée ; vaut pour les suivantes', async () => {
    const { body } = await create().expect(201);
    await service.generate(a.id, body.id, '2030-02-28');
    const before = await occurrences(body.id);

    const { body: updated } = await a.call('patch', `/api/v1/recurrences/${body.id}`).send({ version: 1, template: { amountCents: 95_000 } }).expect(200);
    expect(updated).toMatchObject({ version: 2, template: { amountCents: 95_000, name: 'Loyer' } });
    expect(await occurrences(body.id)).toEqual(before);

    await service.generate(a.id, body.id, '2030-03-31');
    expect((await occurrences(body.id)).map((t) => Number(t.amountCents))).toEqual([80_000, 80_000, 95_000]);
  });

  it('modification avec génération en retard : les occurrences déjà dues partent avec l’ancien montant', async () => {
    const id = await lagging(5, 300n);
    await a.call('patch', `/api/v1/recurrences/${id}`).send({ version: 1, template: { amountCents: 450 } }).expect(200);
    expect((await occurrences(id)).map((t) => Number(t.amountCents))).toEqual([300, 300, 300, 300, 300]);
  });

  it('endDate inclusive, modifiable ; version périmée ⇒ 409', async () => {
    const { body } = await create().expect(201);
    await a.call('patch', `/api/v1/recurrences/${body.id}`).send({ version: 1, endDate: '2030-03-31' }).expect(200);
    await a.call('patch', `/api/v1/recurrences/${body.id}`).send({ version: 1, endDate: null }).expect(409);
    await service.generate(a.id, body.id, '2030-12-31');
    expect(await dates(body.id)).toEqual(['2030-01-31', '2030-02-28', '2030-03-31']);
  });

  it('suppression : liste vide, occurrences passées conservées, génération stoppée ; restauration', async () => {
    const { body } = await create().expect(201);
    await service.generate(a.id, body.id, '2030-01-31');
    await a.call('delete', `/api/v1/recurrences/${body.id}`).expect(204);
    await a.call('get', `/api/v1/recurrences/${body.id}`).expect(404);
    expect(await service.generate(a.id, body.id, '2030-03-31')).toBe(0);
    expect(await dates(body.id)).toEqual(['2030-01-31']);

    await a.call('post', `/api/v1/recurrences/${body.id}/restore`).expect(200);
    await service.generate(a.id, body.id, '2030-03-31');
    expect(await dates(body.id)).toEqual(['2030-01-31', '2030-02-28', '2030-03-31']);
  });

  it('validation : intervalle, unité, dates, montant, champ inconnu ⇒ 400 ; endDate < startDate, CREDIT sur portefeuille ⇒ 422', async () => {
    await create({ interval: 0 }).expect(400);
    await create({ unit: 'HOUR' }).expect(400);
    await create({ startDate: '2030-02-30' }).expect(400);
    await create({}, { amountCents: 0 }).expect(400);
    await create({ lastGeneration: '2030-01-01' }).expect(400);
    await create({ endDate: '2030-01-30' }).expect(422);
    const wallet = (await a.call('post', '/api/v1/accounts').send({ name: 'Portefeuille', trackingType: 'NOT_TRACKED' }).expect(201)).body.id;
    await create({ accountId: wallet }, { type: 'CREDIT' }).expect(422);
  });
});
