import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ATTACHMENT_MAX_BYTES } from '@budgetracker/shared';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { PurgeJob } from '../../src/jobs/purge.job';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E23 — pièces jointes, contre le vrai MinIO (docker-compose.dev.yml en dev, conteneur en CI).
const PDF =Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(992)]); // 1 000 octets
const EXE = Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(200)]);
const png = (size: number) => Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(size - 8)]);

describe('Pièces jointes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  let categoryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    await seed(prisma);
    categoryId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'groceries' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const newTransaction = async (user: TestUser = a, account = accountId) =>
    (await user.call('post', '/api/v1/transactions').send({ accountId: account, categoryId, amountCents: 1_000, date: '2026-06-01' }).expect(201)).body.id as string;
  const upload = (id: string, file: Buffer, filename: string, user: TestUser = a) =>
    user.call('post', `/api/v1/transactions/${id}/attachment`).attach('file', file, { filename, contentType: 'image/png' });
  const keyOf = async (transactionId: string) => (await prisma.attachment.findUniqueOrThrow({ where: { transactionId } })).s3Key;

  it('PDF renommé .png : accepté comme PDF, objet présent dans S3, URL signée courte qui sert le fichier', async () => {
    const id = await newTransaction();
    const { body } = await upload(id, PDF, 'facture.png').expect(201);
    expect(body).toEqual({ id: expect.any(String), originalName: 'facture.png', mime: 'application/pdf', sizeBytes: PDF.length });
    expect((await a.call('get', `/api/v1/transactions/${id}`).expect(200)).body.attachment).toEqual(body);
    expect(await storage.exists(await keyOf(id))).toBe(true);

    const { url } = (await a.call('get', `/api/v1/transactions/${id}/attachment`).expect(200)).body;
    expect(url).toContain('X-Amz-Expires=300');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf'); // type détecté, pas celui annoncé
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
    // Objet jamais public : sans signature, refusé.
    expect((await fetch(url.split('?')[0])).status).toBe(403);
  });

  it('exécutable renommé .png ⇒ 415, rien de stocké', async () => {
    const id = await newTransaction();
    await upload(id, EXE, 'photo.png').expect(415);
    expect(await prisma.attachment.count({ where: { transactionId: id } })).toBe(0);
  });

  it('5 Mo acceptés, 5 Mo + 1 octet ⇒ 413', async () => {
    await upload(await newTransaction(), png(ATTACHMENT_MAX_BYTES), 'max.png').expect(201);
    const id = await newTransaction();
    await upload(id, png(ATTACHMENT_MAX_BYTES + 1), 'trop.png').expect(413);
    expect(await prisma.attachment.count({ where: { transactionId: id } })).toBe(0);
  });

  it('fichier manquant ⇒ 400 ; transaction supprimée ou inconnue ⇒ 404', async () => {
    const id = await newTransaction();
    await a.call('post', `/api/v1/transactions/${id}/attachment`).expect(400);
    await a.call('delete', `/api/v1/transactions/${id}`).expect(204);
    await upload(id, PNG, 'x.png').expect(404);
    await upload('00000000-0000-4000-8000-000000000000', PNG, 'x.png').expect(404);
  });

  it('2ᵉ pièce sur une transaction ⇒ 409 ; après retrait, une nouvelle est acceptée et l’ancien objet est supprimé', async () => {
    const id = await newTransaction();
    await upload(id, PNG, 'a.png').expect(201);
    const first = await keyOf(id);
    await upload(id, PDF, 'b.pdf').expect(409);

    await a.call('delete', `/api/v1/transactions/${id}/attachment`).expect(204);
    expect(await storage.exists(first)).toBe(false);
    await a.call('get', `/api/v1/transactions/${id}/attachment`).expect(404);
    await a.call('delete', `/api/v1/transactions/${id}/attachment`).expect(404);
    await upload(id, PDF, 'b.pdf').expect(201);
  });

  it('deux uploads simultanés sur la même transaction ⇒ un seul retenu', async () => {
    const id = await newTransaction();
    const codes = (await Promise.all([upload(id, PNG, '1.png'), upload(id, PNG, '2.png')])).map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(await prisma.attachment.count({ where: { transactionId: id } })).toBe(1);
  });

  it('quota par utilisateur (User.storageQuotaBytes) : dépassement ⇒ 422, y compris en parallèle', async () => {
    const { b } = users;
    await prisma.user.update({ where: { id: b.id }, data: { storageQuotaBytes: 2_500 } });
    const account = (await b.call('post', '/api/v1/accounts').send({ name: 'B', trackingType: 'NORMAL' }).expect(201)).body.id;
    await upload(await newTransaction(b, account), PNG, '1.png', b).expect(201); // 1 000 / 2 500

    // 5 uploads de 1 000 octets en même temps : la place n'en permet qu'un.
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => newTransaction(b, account)));
    const codes = (await Promise.all(ids.map((id) => upload(id, PNG, 'p.png', b)))).map((r) => r.status).sort();
    expect(codes).toEqual([201, 422, 422, 422, 422]);
    expect((await prisma.attachment.aggregate({ where: { userId: b.id }, _sum: { sizeBytes: true } }))._sum.sizeBytes).toBe(2_000);

    // Quota relevé pour cet utilisateur seulement (offre future) : accepté.
    await prisma.user.update({ where: { id: b.id }, data: { storageQuotaBytes: 10_000 } });
    const withAttachment = new Set((await prisma.attachment.findMany({ where: { transactionId: { in: ids } } })).map((x) => x.transactionId));
    await upload(ids.find((id) => !withAttachment.has(id))!, PNG, 'p.png', b).expect(201);
  });

  it('nom d’origine : affichage seulement (chemin retiré), jamais dans la clé S3 ; UTF-8 conservé', async () => {
    const id = await newTransaction();
    const { body } = await upload(id, PDF, '../../etc/reçu été.pdf').expect(201);
    expect(body.originalName).toBe('reçu été.pdf');
    expect(await keyOf(id)).toMatch(new RegExp(`^attachments/${a.id}/[0-9a-f-]{36}$`));
  });

  it('URL d’une pièce d’un autre utilisateur ⇒ 404', async () => {
    const id = await newTransaction();
    await upload(id, PDF, 'a.pdf').expect(201);
    await users.b.call('get', `/api/v1/transactions/${id}/attachment`).expect(404);
    await users.b.call('delete', `/api/v1/transactions/${id}/attachment`).expect(404);
    await a.call('get', `/api/v1/transactions/${id}/attachment`).expect(200);
  });

  it('purge : l’objet disparaît avec la transaction purgée (31 j), reste à 29 j', async () => {
    const job = app.get(PurgeJob);
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const [t29, t31] = [await newTransaction(), await newTransaction()];
    await upload(t29, PNG, 'a.png').expect(201);
    await upload(t31, PDF, 'b.pdf').expect(201);
    const [k29, k31] = [await keyOf(t29), await keyOf(t31)];
    await prisma.transaction.update({ where: { id: t29 }, data: { deletedAt: ago(29) } });
    await prisma.transaction.update({ where: { id: t31 }, data: { deletedAt: ago(31) } });

    await job.purge(now);

    expect([await storage.exists(k29), await storage.exists(k31)]).toEqual([true, false]);
    expect(await prisma.attachment.count({ where: { s3Key: k31 } })).toBe(0);
  });

  it('purge d’un compte : les objets de ses transactions disparaissent', async () => {
    const job = app.get(PurgeJob);
    const account = (await a.call('post', '/api/v1/accounts').send({ name: 'À purger', trackingType: 'NORMAL' }).expect(201)).body.id;
    const id = await newTransaction(a, account);
    await upload(id, PNG, 'a.png').expect(201);
    const key = await keyOf(id);
    await prisma.account.update({ where: { id: account }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });

    await job.purge(new Date());

    expect(await storage.exists(key)).toBe(false);
  });
});
