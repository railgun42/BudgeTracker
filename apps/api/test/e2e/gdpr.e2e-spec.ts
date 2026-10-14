import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../../src/common/cookies';
import { Prisma } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E28 — export JSON/CSV et suppression réelle du compte (BDD + S3 + sessions), contre Postgres et MinIO.
const PDF = Buffer.from('%PDF-1.4 %%EOF', 'latin1');
// Exclues de l'export : secrets d'authentification (hashes).
const NOT_EXPORTED = ['Credential', 'EmailToken', 'RefreshToken'];

describe('RGPD — export et suppression de compte (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let users: TwoUsers;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    await seed(prisma);
    users = await createTwoUsers(app);
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  // Au moins une ligne dans chaque table exportée (hors User) pour `user`.
  async function populate(user: TestUser) {
    const account = (await user.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body;
    const savings = (await user.call('post', '/api/v1/accounts').send({ name: 'Livret', trackingType: 'WITH_INTEREST' }).expect(201)).body;
    await user.call('post', `/api/v1/accounts/${savings.id}/interest-rates`).send({ rateBp: 300, effectiveDate: '2026-01-01' }).expect(201);
    const category = (await user.call('post', '/api/v1/categories').send({ name: 'Perso', color: '#123456' }).expect(201)).body;
    const tag = (await user.call('post', '/api/v1/tags').send({ name: `tag-${randomUUID()}` }).expect(201)).body;
    const tx = (
      await user
        .call('post', '/api/v1/transactions')
        .send({ accountId: account.id, categoryId: category.id, amountCents: 1234, date: '2026-03-01', name: 'Café; "noir"', tagIds: [tag.id] })
        .expect(201)
    ).body;
    await user.call('post', `/api/v1/transactions/${tx.id}/attachment`).attach('file', PDF, 'ticket.pdf').expect(201);
    await user.call('post', '/api/v1/transfers').send({ fromAccountId: account.id, toAccountId: savings.id, amountCents: 500, date: '2026-03-02' }).expect(201);
    const recurrence = (
      await user
        .call('post', '/api/v1/recurrences')
        .send({ accountId: account.id, interval: 1, unit: 'MONTH', startDate: '2030-01-31', template: { categoryId: category.id, amountCents: 900, tagIds: [tag.id] } })
        .expect(201)
    ).body;
    await user.call('post', '/api/v1/scenarios').send({ name: 'Netflix', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 999 }] } }).expect(201);
    // Sans endpoint de création directe : identité Google et crédit d'intérêts.
    await prisma.oAuthIdentity.create({ data: { userId: user.id, provider: 'google', providerId: randomUUID() } });
    await prisma.interestCredit.create({ data: { accountId: savings.id, year: 2025 } });
    await prisma.user.update({ where: { id: user.id }, data: { termsAcceptedAt: new Date('2026-10-14T08:00:00Z'), termsVersion: '2026-10-14' } });
    const s3Key = (await prisma.attachment.findUniqueOrThrow({ where: { transactionId: tx.id } })).s3Key;
    return { accountId: account.id as string, savingsId: savings.id as string, txId: tx.id as string, recurrenceId: recurrence.id as string, tagId: tag.id as string, s3Key };
  }

  describe('export', () => {
    let a: Awaited<ReturnType<typeof populate>>;
    let b: Awaited<ReturnType<typeof populate>>;
    beforeAll(async () => {
      a = await populate(users.a);
      b = await populate(users.b);
    });

    it('JSON : toutes les tables de l’utilisateur, aucune donnée d’un autre ni secret', async () => {
      const res = await users.a.call('get', '/api/v1/me/export').expect(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="budgetracker-export.json"');
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      const data = res.body as Record<string, Record<string, unknown>[]>;

      // Chaque table du schéma est exportée, sauf les secrets ; une table ajoutée plus tard fait échouer ce test.
      expect(Object.keys(data).sort()).toEqual(Object.keys(Prisma.ModelName).filter((m) => !NOT_EXPORTED.includes(m)).sort());
      for (const [table, rows] of Object.entries(data)) expect([table, rows.length]).not.toEqual([table, 0]);
      for (const rows of Object.values(data)) for (const row of rows) if ('userId' in row) expect(row.userId).toBe(users.a.id);
      expect(data.User).toEqual([expect.objectContaining({ id: users.a.id, name: 'A', termsAcceptedAt: '2026-10-14T08:00:00.000Z', termsVersion: '2026-10-14' })]);

      // Sérialisation : centimes en number, jour en 'YYYY-MM-DD', horodatage ISO.
      expect(data.Transaction.find((t) => t.id === a.txId)).toMatchObject({ amountCents: 1234, date: '2026-03-01', deletedAt: null, createdAt: expect.stringMatching(/Z$/) });
      expect(data.TransactionTag).toContainEqual({ transactionId: a.txId, tagId: a.tagId });
      expect(data.TransactionTemplate).toEqual([expect.objectContaining({ recurrenceId: a.recurrenceId, amountCents: 900 })]);
      expect(data.InterestCredit).toEqual([expect.objectContaining({ accountId: a.savingsId, year: 2025 })]);
      expect(data.Attachment).toEqual([expect.objectContaining({ transactionId: a.txId, mime: 'application/pdf' })]);

      const text = JSON.stringify(data);
      for (const id of [users.b.id, b.accountId, b.savingsId, b.txId, b.recurrenceId, b.tagId]) expect(text).not.toContain(id);
      for (const secret of ['s3Key', 'passwordHash', 'tokenHash', a.s3Key]) expect(text).not.toContain(secret);
    });

    it('CSV : une section par table, champs échappés, rien de l’autre utilisateur', async () => {
      const res = await users.a.call('get', '/api/v1/me/export?format=csv').expect(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="budgetracker-export.csv"');
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.text.startsWith('\uFEFFUser\r\n')).toBe(true); // BOM : Excel lit l'UTF-8
      const lines = res.text.slice(1).split('\r\n');
      expect(lines[1].split(';')).toEqual(expect.arrayContaining(['termsAcceptedAt', 'termsVersion']));
      const header = lines[lines.indexOf('Transaction') + 1].split(';');
      expect(header).toEqual(expect.arrayContaining(['id', 'accountId', 'amountCents', 'date', 'name']));
      const row = lines.find((l) => l.startsWith(a.txId))!;
      expect(row).toContain('"Café; ""noir"""');
      expect(row).toContain(';1234;');
      expect(row).toContain(';2026-03-01;');
      for (const table of Object.keys(Prisma.ModelName).filter((m) => !NOT_EXPORTED.includes(m))) expect(lines).toContain(table);
      for (const id of [users.b.id, b.accountId, b.txId]) expect(res.text).not.toContain(id);
    });

    it('format inconnu ⇒ 400 ; sans session ⇒ 401', async () => {
      await users.a.call('get', '/api/v1/me/export?format=xml').expect(400);
      await request(app.getHttpServer()).get('/api/v1/me/export').expect(401);
    });
  });

  describe('DELETE /me', () => {
    let pair: TwoUsers;
    beforeAll(async () => (pair = await createTwoUsers(app)));
    afterAll(() => pair?.cleanup());

    it('efface toutes les lignes portant userId, les objets S3 et invalide la session ; l’autre utilisateur intact', async () => {
      const { a: userA, b: userB } = pair;
      const a = await populate(userA);
      const b = await populate(userB);
      // Objet orphelin sous le préfixe de A (ex. échec S3 passé) : effacé aussi.
      const orphan = `attachments/${userA.id}/${randomUUID()}`;
      await storage.put(orphan, PDF, 'application/pdf');
      // Session complète (access + refresh) de A, pour vérifier qu'elle ne sert plus après la suppression.
      const { session } = await app.get(AuthService).openSession(userA.id);
      const cookie = `${ACCESS_COOKIE}=${session.access}; ${REFRESH_COOKIE}=${session.refresh}; ${CSRF_COOKIE}=x`;
      const bExportBefore = (await userB.call('get', '/api/v1/me/export').expect(200)).body;

      // Sans en-tête CSRF ⇒ 403, rien n'est supprimé.
      await request(app.getHttpServer()).delete('/api/v1/me').set('Cookie', cookie).expect(403);
      expect(await prisma.user.count({ where: { id: userA.id } })).toBe(1);

      const res = await request(app.getHttpServer()).delete('/api/v1/me').set('Cookie', cookie).set('X-CSRF-Token', 'x').expect(204);
      const cleared = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(cleared).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${ACCESS_COOKIE}=;.*Expires=Thu, 01 Jan 1970`)), expect.stringMatching(new RegExp(`^${REFRESH_COOKIE}=;.*Expires=Thu, 01 Jan 1970`))]));

      // Comptage SQL sur toutes les tables portant userId, plus les tables liées sans userId.
      const tables = (await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns WHERE column_name = 'userId' AND table_schema = current_schema()`).map((t) => t.table_name);
      expect(tables.length).toBeGreaterThanOrEqual(13);
      const counts = Object.fromEntries(
        await Promise.all(
          tables.map(async (t) => {
            const [{ count }] = await prisma.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM "${t}" WHERE "userId" = $1::uuid`, userA.id);
            return [t, count];
          }),
        ),
      );
      expect(counts).toEqual(Object.fromEntries(tables.map((t) => [t, 0])));
      expect(await prisma.user.count({ where: { id: userA.id } })).toBe(0);
      expect(await prisma.transactionTag.count({ where: { tagId: a.tagId } })).toBe(0);
      expect(await prisma.transactionTemplate.count({ where: { recurrenceId: a.recurrenceId } })).toBe(0);
      expect(await prisma.interestCredit.count({ where: { accountId: a.savingsId } })).toBe(0);

      // Objets S3 effacés (pièce jointe et orphelin) ; ceux de B restent.
      expect(await storage.exists(a.s3Key)).toBe(false);
      expect(await storage.exists(orphan)).toBe(false);
      expect(await storage.exists(b.s3Key)).toBe(true);

      // Les cookies de A ne servent plus : jeton d'accès encore signé valide ⇒ 401, refresh ⇒ 401.
      await request(app.getHttpServer()).get('/api/v1/me').set('Cookie', cookie).expect(401);
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-CSRF-Token', 'x').expect(401);
      await userA.call('get', '/api/v1/accounts').expect(401);

      // B intact.
      expect((await userB.call('get', '/api/v1/me/export').expect(200)).body).toEqual(bExportBefore);
    });
  });
});
