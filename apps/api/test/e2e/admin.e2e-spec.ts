import { ArgumentsHost, INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { grantAdmin } from '../../scripts/grant-admin';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';
import { jobRuns, trackJob } from '../../src/jobs/job-runs';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { uniqueEmail } from '../helpers/db';
import { createTwoUsers, TwoUsers } from '../helpers/two-users';

// Toutes les clés (imbriquées) d'une réponse JSON.
const keysOf = (value: unknown): string[] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : [];

describe('Administration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).email;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    users = await createTwoUsers(app);
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: [users.a.id, users.b.id] } } });
    await users.cleanup();
  });

  afterAll(() => app.close());

  describe('GET /admin/stats', () => {
    it('401 sans session, 403 pour un utilisateur, 200 pour un admin', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/stats').expect(401);
      await users.a.call('get', '/api/v1/admin/stats').expect(403);
      await grantAdmin(prisma, await emailOf(users.a.id));
      await users.a.call('get', '/api/v1/admin/stats').expect(200);
      await users.b.call('get', '/api/v1/admin/stats').expect(403);
    });

    it('rôle relu à chaque requête : retiré en base ⇒ 403 aussitôt, sans nouvelle session', async () => {
      await grantAdmin(prisma, await emailOf(users.a.id));
      await users.a.call('get', '/api/v1/admin/stats').expect(200);
      await prisma.user.update({ where: { id: users.a.id }, data: { role: 'USER' } });
      await users.a.call('get', '/api/v1/admin/stats').expect(403);
    });

    it('agrégats seulement : ni e-mail, ni montant, ni identifiant d’utilisateur', async () => {
      await grantAdmin(prisma, await emailOf(users.a.id));
      const { body: account } = await users.b.call('post', '/api/v1/accounts').send({ name: 'Compte de B', trackingType: 'NORMAL' }).expect(201);
      await users.b
        .call('post', '/api/v1/transactions')
        .send({ accountId: account.id, name: 'Secret', date: '2026-01-02', amountCents: 987_654, type: 'DEBIT' })
        .expect(201);

      const { body, text } = await users.a.call('get', '/api/v1/admin/stats').expect(200);
      expect(keysOf(body).filter((k) => /email|amount|cents|name|balance/i.test(k))).toEqual([]);
      expect(text).not.toContain('@');
      for (const secret of ['Secret', 'Compte de B', users.a.id, users.b.id, account.id]) expect(text).not.toContain(secret);

      // Comptages globaux (d'autres suites tournent en parallèle) : au moins nos données.
      expect(body.users.total).toBeGreaterThanOrEqual(2);
      expect(body.users.verified).toBeGreaterThanOrEqual(2);
      expect(body.users.new7d).toBeGreaterThanOrEqual(2);
      expect(body.users.new30d).toBeGreaterThanOrEqual(body.users.new7d);
      expect(body.users.active30d).toBeGreaterThanOrEqual(body.users.active7d);
      expect(body.volumes.accounts).toBeGreaterThanOrEqual(1);
      expect(body.volumes.transactions).toBeGreaterThanOrEqual(1);
      expect(body.database.sizeBytes).toBeGreaterThan(0);
      expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(body.api).toMatchObject({ uptimeSeconds: expect.any(Number), memoryRssBytes: expect.any(Number), errorsSinceStart: expect.any(Number) });
      expect(Object.keys(body.api.jobs).sort()).toEqual(['interest', 'purge', 'recurrences']);
    });

    it('compte les erreurs serveur depuis le démarrage (pas les 4xx)', async () => {
      await grantAdmin(prisma, await emailOf(users.a.id));
      const errors = async () => (await users.a.call('get', '/api/v1/admin/stats').expect(200)).body.api.errorsSinceStart as number;
      const before = await errors();
      const host = { switchToHttp: () => ({ getResponse: () => ({ status: () => ({ json: () => undefined }) }) }) } as unknown as ArgumentsHost;
      const filter = new AllExceptionsFilter();
      Object.assign(filter, { logger: { error: () => undefined } });
      filter.catch(new Error('boom'), host);
      filter.catch(new InternalServerErrorException(), host);
      await users.b.call('get', '/api/v1/admin/stats').expect(403);
      expect(await errors()).toBe(before + 2);
    });

    it('dernière exécution des tâches planifiées : heure et succès/échec', async () => {
      await grantAdmin(prisma, await emailOf(users.a.id));
      await trackJob('interest', async () => 1);
      await expect(trackJob('purge', () => Promise.reject(new Error('S3 indisponible')))).rejects.toThrow();
      const { jobs } = (await users.a.call('get', '/api/v1/admin/stats').expect(200)).body.api;
      expect(jobs.interest).toEqual({ at: jobRuns.interest!.at, ok: true });
      expect(jobs.purge).toMatchObject({ ok: false });
    });
  });

  describe('rôle', () => {
    it('GET /me expose le rôle ; aucune route HTTP ne le modifie', async () => {
      expect((await users.a.call('get', '/api/v1/me').expect(200)).body.role).toBe('USER');
      await users.a.call('patch', '/api/v1/me').send({ role: 'ADMIN' }).expect(404);
      await users.a.call('put', '/api/v1/me').send({ role: 'ADMIN' }).expect(404);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: users.a.id } })).role).toBe('USER');
      await grantAdmin(prisma, await emailOf(users.a.id));
      expect((await users.a.call('get', '/api/v1/me').expect(200)).body.role).toBe('ADMIN');
    });

    it('la base refuse un administrateur sans e-mail vérifié (CHECK)', async () => {
      const { id } = await prisma.user.create({ data: { email: uniqueEmail(), name: 'X' } });
      await expect(prisma.user.update({ where: { id }, data: { role: 'ADMIN' } })).rejects.toThrow();
      await prisma.user.delete({ where: { id } });
    });
  });

  describe('script admin:grant', () => {
    it('refuse un e-mail inconnu', async () => {
      await expect(grantAdmin(prisma, uniqueEmail())).rejects.toThrow('Aucun compte');
    });

    it('refuse un e-mail non vérifié, sans rien changer ni journaliser', async () => {
      const { id, email } = await prisma.user.create({ data: { email: uniqueEmail(), name: 'X' } });
      await expect(grantAdmin(prisma, email)).rejects.toThrow('non vérifié');
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).role).toBe('USER');
      expect(await prisma.adminAuditLog.count({ where: { targetId: id } })).toBe(0);
      await prisma.user.delete({ where: { id } });
    });

    it('attribue le rôle (e-mail insensible à la casse), journalise sans donnée financière ni e-mail, idempotent', async () => {
      const email = await emailOf(users.a.id);
      expect(await grantAdmin(prisma, `  ${email.toUpperCase()} `)).toEqual({ userId: users.a.id, alreadyAdmin: false });
      expect(await grantAdmin(prisma, email)).toEqual({ userId: users.a.id, alreadyAdmin: true });

      const logs = await prisma.adminAuditLog.findMany({ where: { targetId: users.a.id } });
      expect(logs).toEqual([{ id: expect.any(String), adminId: null, action: 'ADMIN_GRANTED', targetId: users.a.id, createdAt: expect.any(Date) }]);
    });
  });
});
