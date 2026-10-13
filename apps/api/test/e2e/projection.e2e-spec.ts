import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E26 — projection du solde et objectif d'épargne sur un jeu de données connu, au 31/03/2026 (paramètre `today`).
// Les cas de calcul sont détaillés dans src/simulations/engine/{projection,savings-goal}.spec.ts.
describe('Projection et objectif d’épargne (e2e)', () => {
  let app: INestApplication;
  let users: TwoUsers;
  let a: TestUser;
  const ids: Record<string, string> = {};
  const projection = (query: string) => a.call('get', `/api/v1/simulations/projection?today=2026-03-31&${query}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    users = await createTwoUsers(app);
    a = users.a;

    const account = async (name: string, trackingType: string, body: object = {}) =>
      (await a.call('post', '/api/v1/accounts').send({ name, trackingType, ...body }).expect(201)).body.id as string;
    const categories = (await a.call('get', '/api/v1/categories').expect(200)).body as { id: string; system: boolean }[];
    const categoryId = categories.find((c) => c.system)!.id;
    const add = async (date: string, amountCents: number, type = 'DEBIT') =>
      (await a.call('post', '/api/v1/transactions').send({ accountId: ids.main, categoryId, amountCents, date, type }).expect(201)).body;
    const transfer = (toAccountId: string, amountCents: number, date: string) =>
      a.call('post', '/api/v1/transfers').send({ fromAccountId: ids.main, toAccountId, amountCents, date }).expect(201);

    // Solde de départ (exclu du rythme) : +1 000 €.
    ids.main = await account('Courant', 'NORMAL', { openingBalance: { amountCents: 100_000, date: '2026-01-01' } });
    ids.savings = await account('Livret', 'NORMAL');
    ids.wallet = await account('Portefeuille', 'NOT_TRACKED');
    ids.empty = await account('Vide', 'NORMAL');

    // Fenêtre de 3 mois = ]31/12/2025, 31/03/2026] : dépenses non récurrentes = 300 + 150 + 60 (espèces) = 510 €.
    await add('2025-12-31', 99_999); // hors fenêtre (borne exclue), mais dans le solde
    await add('2026-01-10', 30_000);
    await add('2026-02-05', 250_000, 'CREDIT'); // revenu : pas une dépense
    await transfer(ids.savings, 50_000, '2026-02-10'); // virement interne : exclu du rythme
    await transfer(ids.wallet, 6_000, '2026-02-12'); // retrait d'espèces : dépense
    await add('2026-03-20', 15_000);
    const deleted = await add('2026-03-01', 999);
    await a.call('delete', `/api/v1/transactions/${deleted.id}`).expect(204);
    // Récurrence le 15 : occurrences déjà générées (jusqu'au jour réel) exclues du rythme et des transactions futures,
    // les occurrences > today sont projetées par le moteur (ni oubliées, ni comptées deux fois).
    await a
      .call('post', '/api/v1/recurrences')
      .send({ accountId: ids.main, interval: 1, unit: 'MONTH', startDate: '2026-01-15', template: { categoryId, amountCents: 9_000 } })
      .expect(201);
    // Transaction future saisie à la main.
    await add('2026-05-01', 50_000, 'CREDIT');
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('solde + récurrences futures + transactions futures − rythme moyen (3 mois par défaut)', async () => {
    // Solde au 31/03 : 1 000 − 999,99 − 300 + 2 500 − 500 − 60 − 150 − 3 × 90 = 1 220,01 €.
    const { body } = await projection(`accountId=${ids.main}&months=2`).expect(200);
    expect(body).toEqual({
      averageMonthlySpendCents: 17_000,
      points: [
        { date: '2026-03-31', balanceCents: 122_001 },
        { date: '2026-04-30', balanceCents: 122_001 - 9_000 - 17_000 },
        { date: '2026-05-31', balanceCents: 122_001 - 2 * 9_000 + 50_000 - 2 * 17_000 },
      ],
    });
  });

  it('fenêtre paramétrable : 1 mois ⇒ seulement les dépenses de mars', async () => {
    expect((await projection(`accountId=${ids.main}&months=1&windowMonths=1`).expect(200)).body.averageMonthlySpendCents).toBe(15_000);
  });

  it('fenêtre vide ⇒ rythme 0', async () => {
    expect((await projection(`accountId=${ids.empty}&months=2`).expect(200)).body).toEqual({
      averageMonthlySpendCents: 0,
      points: [
        { date: '2026-03-31', balanceCents: 0 },
        { date: '2026-04-30', balanceCents: 0 },
        { date: '2026-05-31', balanceCents: 0 },
      ],
    });
  });

  it('compte sans solde (NOT_TRACKED) ⇒ 422 ; compte inconnu ⇒ 404', async () => {
    await projection(`accountId=${ids.wallet}&months=2`).expect(422);
    await projection('accountId=00000000-0000-4000-8000-000000000000&months=2').expect(404);
    await a.call('get', `/api/v1/simulations/savings-goal?targetCents=1000&months=2&accountId=${ids.wallet}`).expect(422);
  });

  it('objectif sur un compte : épargne = solde actuel, effort mensuel et progression', async () => {
    const { body } = await a.call('get', `/api/v1/simulations/savings-goal?targetCents=500000&months=10&accountId=${ids.main}&today=2026-03-31`).expect(200);
    // Reste 3 779,99 € / 10 ⇒ 378,00 € (arrondi supérieur) ; 1 220,01 / 5 000 = 24,40 %.
    expect(body).toEqual({ savedCents: 122_001, remainingCents: 377_999, monthlyCents: 37_800, progressBp: 2_440 });
  });

  it('objectif sans compte : épargne 0', async () => {
    const { body } = await a.call('get', '/api/v1/simulations/savings-goal?targetCents=500000&months=12').expect(200);
    expect(body).toEqual({ savedCents: 0, remainingCents: 500_000, monthlyCents: 41_667, progressBp: 0 });
  });

  it.each([
    'projection?months=2', // compte manquant
    'projection?accountId=x&months=2',
    'projection?accountId=00000000-0000-4000-8000-000000000000&months=0',
    'projection?accountId=00000000-0000-4000-8000-000000000000&months=2&windowMonths=0',
    'projection?accountId=00000000-0000-4000-8000-000000000000&months=2&today=2026-02-30',
    'savings-goal?targetCents=0&months=12',
    'savings-goal?targetCents=1000&months=601',
    'savings-goal?targetCents=1000&months=12&savedCents=5', // champ inconnu : l'épargne vient du compte
  ])('%s ⇒ 400', async (query) => {
    await a.call('get', `/api/v1/simulations/${query}`).expect(400);
  });
});
