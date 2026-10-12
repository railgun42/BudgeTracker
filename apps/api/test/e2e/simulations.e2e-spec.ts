import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E25 — calculateurs crédit/placement : validation des paramètres et branchement des moteurs purs.
// Les valeurs de référence sont détaillées dans src/simulations/engine/*.spec.ts.
describe('Calculateurs (e2e)', () => {
  let app: INestApplication;
  let users: TwoUsers;
  let a: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    users = await createTwoUsers(app);
    a = users.a;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('GET /simulations/loan : 10 000 € / 5 % / 60 mois', async () => {
    const { body } = await a.call('get', '/api/v1/simulations/loan?principalCents=1000000&annualRateBp=500&months=60').expect(200);
    expect(body).toEqual({ monthlyPaymentCents: 18_871, lastPaymentCents: 18_885, totalPaidCents: 1_132_274, totalInterestCents: 132_274 });
  });

  it('GET /simulations/investment : intérêts composés avec inflation', async () => {
    const { body } = await a.call('get', '/api/v1/simulations/investment?initialCents=1000000&annualRateBp=500&months=120&inflationBp=200').expect(200);
    expect(body).toEqual({ finalCents: 1_647_009, contributedCents: 1_000_000, interestCents: 647_009, realFinalCents: 1_351_121 });
  });

  it.each([
    'loan?annualRateBp=500&months=60', // capital manquant
    'loan?principalCents=0&annualRateBp=500&months=60',
    'loan?principalCents=10.5&annualRateBp=500&months=60',
    'loan?principalCents=abc&annualRateBp=500&months=60',
    'loan?principalCents=1000&annualRateBp=2001&months=60',
    'loan?principalCents=1000&annualRateBp=500&months=601',
    'loan?principalCents=1000&annualRateBp=500&months=60&accountId=x', // champ inconnu
    'investment?initialCents=-1&annualRateBp=500&months=12',
    'investment?initialCents=100&annualRateBp=500&months=12&monthlyContributionCents=1000000001',
    'investment?initialCents=100&annualRateBp=500&months=12&inflationBp=-5',
  ])('%s ⇒ 400', async (query) => {
    await a.call('get', `/api/v1/simulations/${query}`).expect(400);
  });

  it('sans session ⇒ 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/simulations/loan?principalCents=1000&annualRateBp=500&months=60').expect(401);
  });
});
