import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { InterestService } from '../../src/interest/interest.service';
import { InterestJob } from '../../src/jobs/interest.job';
import { PurgeJob } from '../../src/jobs/purge.job';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { todayUtc } from '../../src/recurrences/recurrences.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E22 — intérêts : taux, crédit annuel idempotent, job. Horloge injectée (credit(…, today)) sur des données en 2029–2030 ;
// le vrai job (jour réel) est testé sur l'année close précédente.
describe('Intérêts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: InterestService;
  let users: TwoUsers;
  let a: TestUser;
  let interestCategoryId: string;
  let rentCategoryId: string;
  const YEAR = Number(todayUtc().slice(0, 4));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(InterestService);
    await seed(prisma);
    interestCategoryId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'interest' } })).id;
    rentCategoryId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'housing.rent' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const rates = (id: string) => a.call('get', `/api/v1/accounts/${id}/interest-rates`);
  const setRate = (id: string, body: object) => a.call('post', `/api/v1/accounts/${id}/interest-rates`).send(body);
  // Livret de 10 000 € au 1er janvier, avec un taux facultatif.
  const livret = async (year: number, rateBp?: number, trackingType = 'WITH_INTEREST') => {
    const { body } = await a
      .call('post', '/api/v1/accounts')
      .send({ name: 'Livret', trackingType, openingBalance: { amountCents: 1_000_000, date: `${year}-01-01` } })
      .expect(201);
    if (rateBp !== undefined) await setRate(body.id, { rateBp, effectiveDate: `${year}-01-01` }).expect(201);
    return body.id as string;
  };
  const credits = async (accountId: string) =>
    (await prisma.transaction.findMany({ where: { accountId, categoryId: interestCategoryId, deletedAt: null }, orderBy: { date: 'asc' } })).map((t) => [
      t.date.toISOString().slice(0, 10),
      Number(t.amountCents),
    ]);

  describe('taux', () => {
    it('historique trié par date d’effet ; même date ⇒ remplacé ; missingRate tant qu’aucun taux n’est en vigueur', async () => {
      const id = await livret(2029);
      expect((await rates(id).expect(200)).body).toEqual({ rates: [], missingRate: true });

      const { body: created } = await setRate(id, { rateBp: 250, effectiveDate: `${YEAR}-06-01` }).expect(201);
      expect(created).toEqual({ id: expect.any(String), accountId: id, rateBp: 250, effectiveDate: `${YEAR}-06-01` });
      await setRate(id, { rateBp: 300, effectiveDate: `${YEAR}-01-01` }).expect(201);
      await setRate(id, { rateBp: 275, effectiveDate: `${YEAR}-06-01` }).expect(201);

      const { body } = await rates(id).expect(200);
      expect(body.missingRate).toBe(false);
      expect(body.rates.map((r: { rateBp: number; effectiveDate: string }) => [r.effectiveDate, r.rateBp])).toEqual([
        [`${YEAR}-01-01`, 300],
        [`${YEAR}-06-01`, 275],
      ]);
    });

    it('taux en vigueur seulement après le 16/12 ⇒ année non calculable, missingRate', async () => {
      const id = await livret(2029);
      await setRate(id, { rateBp: 300, effectiveDate: `${YEAR}-12-20` }).expect(201);
      expect((await rates(id).expect(200)).body.missingRate).toBe(true);
    });

    it('compte non WITH_INTEREST : pas de missingRate, saisie de taux ⇒ 422', async () => {
      const id = await livret(2029, undefined, 'NORMAL');
      expect((await rates(id).expect(200)).body).toEqual({ rates: [], missingRate: false });
      await setRate(id, { rateBp: 300, effectiveDate: '2029-01-01' }).expect(422);
    });

    it('validation ⇒ 400', async () => {
      const id = await livret(2029);
      for (const body of [
        { rateBp: 1.5, effectiveDate: '2029-01-01' },
        { rateBp: -1, effectiveDate: '2029-01-01' },
        { rateBp: 10_001, effectiveDate: '2029-01-01' },
        { rateBp: '300', effectiveDate: '2029-01-01' },
        { rateBp: 300, effectiveDate: '2029-02-30' },
        { rateBp: 300, effectiveDate: '2029-01-01', accountId: id },
      ]) {
        await setRate(id, body).expect(400);
      }
      await a.call('get', '/api/v1/accounts/not-a-uuid/interest-rates').expect(400);
    });
  });

  describe('crédit annuel', () => {
    it('solde constant ⇒ taux × solde, CREDIT « Intérêts » au 31/12 ; rattrapage des années closes avec capitalisation annuelle', async () => {
      const id = await livret(2029, 300);
      expect(await service.credit(a.id, id, '2031-06-01')).toBe(2);
      // 2029 : 10 000 € × 3 % = 300 €. 2030 : base 10 300 € ⇒ 1 287,5 → 1 288 c par quinzaine × 24.
      expect(await credits(id)).toEqual([
        ['2029-12-31', 30_000],
        ['2030-12-31', 30_912],
      ]);
      const [t] = await prisma.transaction.findMany({ where: { accountId: id, categoryId: interestCategoryId } });
      expect(t).toMatchObject({ type: 'CREDIT', name: 'Intérêts', userId: a.id });
      // L'année en cours (2031) n'est pas close.
      expect(await prisma.interestCredit.count({ where: { accountId: id, year: 2031 } })).toBe(0);
    });

    it('retrait en milieu de quinzaine ⇒ le solde minimum est retenu', async () => {
      const id = await livret(2030, 300);
      const move = (type: string, date: string) =>
        a.call('post', '/api/v1/transactions').send({ accountId: id, categoryId: rentCategoryId, amountCents: 400_000, type, date }).expect(201);
      await move('DEBIT', '2030-01-08');
      await move('CREDIT', '2030-01-10');
      await service.credit(a.id, id, '2031-01-01');
      // 1re quinzaine : 6 000 € × 3 % / 24 = 7,50 € ; 23 autres : 12,50 €.
      expect(await credits(id)).toEqual([['2030-12-31', 750 + 23 * 1250]]);
    });

    it('transaction antérieure au solde de départ (E30) : hors des soldes journaliers', async () => {
      const id = await livret(2030, 300);
      await a.call('post', '/api/v1/transactions').send({ accountId: id, categoryId: rentCategoryId, amountCents: 400_000, type: 'CREDIT', date: '2029-12-15' }).expect(201);
      await service.credit(a.id, id, '2031-01-01');
      expect(await credits(id)).toEqual([['2030-12-31', 30_000]]);
    });

    it('deux fois ⇒ une seule transaction ; cinq exécutions simultanées ⇒ une seule', async () => {
      const id = await livret(2030, 300);
      expect(await service.credit(a.id, id, '2031-01-01')).toBe(1);
      expect(await service.credit(a.id, id, '2031-01-01')).toBe(0);
      expect(await credits(id)).toHaveLength(1);

      const other = await livret(2030, 300);
      const counts = await Promise.all(Array.from({ length: 5 }, () => service.credit(a.id, other, '2031-01-01')));
      expect(counts.reduce((s, n) => s + n, 0)).toBe(1);
      expect(await credits(other)).toEqual([['2030-12-31', 30_000]]);
    });

    it('job réel : deux exécutions, puis deux simultanées ⇒ une seule transaction pour l’année close', async () => {
      const id = await livret(YEAR - 1, 300);
      const job = app.get(InterestJob);
      await job.handleCron();
      await job.handleCron();
      await Promise.all([job.handleCron(), job.handleCron()]);
      expect(await credits(id)).toEqual([[`${YEAR - 1}-12-31`, 30_000]]);
    });

    it('sans taux ⇒ rien créé et missingRate remonté par l’API ; un taux saisi en retard est rattrapé', async () => {
      const id = await livret(2030);
      expect(await service.credit(a.id, id, '2031-01-01')).toBe(0);
      expect(await credits(id)).toEqual([]);
      expect((await rates(id).expect(200)).body.missingRate).toBe(true);

      await setRate(id, { rateBp: 300, effectiveDate: '2030-01-01' }).expect(201);
      expect(await service.credit(a.id, id, '2031-02-01')).toBe(1);
    });

    it('compte non WITH_INTEREST ou supprimé ⇒ ignoré', async () => {
      const normal = await livret(2030, 300);
      await a.call('patch', `/api/v1/accounts/${normal}`).send({ version: 1, trackingType: 'NORMAL' }).expect(200);
      const deleted = await livret(2030, 300);
      await a.call('delete', `/api/v1/accounts/${deleted}`).expect(204);
      expect(await service.credit(a.id, normal, '2031-01-01')).toBe(0);
      expect(await service.credit(a.id, deleted, '2031-01-01')).toBe(0);
      expect(await prisma.interestCredit.count({ where: { accountId: { in: [normal, deleted] } } })).toBe(0);
    });

    it('autre utilisateur ⇒ rien (filtre userId)', async () => {
      const id = await livret(2030, 300);
      expect(await service.credit(users.b.id, id, '2031-01-01')).toBe(0);
      expect(await credits(id)).toEqual([]);
    });

    it('crédit supprimé par l’utilisateur ⇒ jamais recréé, même après la purge des 30 jours', async () => {
      const id = await livret(2030, 300);
      await service.credit(a.id, id, '2031-01-01');
      const t = await prisma.transaction.findFirstOrThrow({ where: { accountId: id, categoryId: interestCategoryId } });
      await a.call('delete', `/api/v1/transactions/${t.id}`).expect(204);
      expect(await service.credit(a.id, id, '2031-01-02')).toBe(0);

      await prisma.transaction.update({ where: { id: t.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
      await app.get(PurgeJob).purge(new Date());
      expect(await prisma.transaction.count({ where: { id: t.id } })).toBe(0);
      expect(await prisma.interestCredit.findUniqueOrThrow({ where: { accountId_year: { accountId: id, year: 2030 } } })).toMatchObject({ transactionId: null });
      expect(await service.credit(a.id, id, '2031-01-03')).toBe(0);
      expect(await credits(id)).toEqual([]);
    });
  });
});
