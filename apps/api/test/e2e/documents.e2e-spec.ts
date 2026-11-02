import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// Coffre-fort : documents de l'utilisateur (pièces de transactions + dépôts directs), tags, téléchargement, contre MinIO.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(992)]);
const EXE = Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(200)]);

describe('Coffre-fort (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    await seed(prisma);
    users = await createTwoUsers(app);
    a = users.a;
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const deposit = (file: Buffer, filename: string, user: TestUser = a) => user.call('post', '/api/v1/documents').attach('file', file, { filename, contentType: 'application/pdf' });
  const list = async () => (await a.call('get', '/api/v1/documents').expect(200)).body as { id: string; transaction: { id: string } | null; tagIds: string[] }[];
  const newTag = async (name: string) => (await a.call('post', '/api/v1/tags').send({ name: `${name}-${Math.random()}` }).expect(201)).body.id as string;
  const keyOf = async (id: string) => (await prisma.attachment.findUniqueOrThrow({ where: { id } })).s3Key;

  it('liste dépôts directs et pièces de transactions, plus récent d’abord ; corbeille exclue', async () => {
    const tx = (await a.call('post', '/api/v1/transactions').send({ accountId, amountCents: 1_000, date: '2026-06-01', name: 'Courses' }).expect(201)).body;
    const piece = (await a.call('post', `/api/v1/transactions/${tx.id}/attachment`).attach('file', PNG, 'ticket.png').expect(201)).body;
    const direct = (await deposit(PDF, '<img src=x onerror=alert(1)>.pdf').expect(201)).body;
    expect(direct).toEqual({ id: expect.any(String), originalName: '<img src=x onerror=alert(1)>.pdf', mime: 'application/pdf', sizeBytes: PDF.length });

    const docs = await list();
    expect(docs.slice(0, 2)).toEqual([
      { ...direct, createdAt: expect.stringMatching(/Z$/), tagIds: [], transaction: null },
      { ...piece, createdAt: expect.stringMatching(/Z$/), tagIds: [], transaction: { id: tx.id, name: 'Courses', date: '2026-06-01', accountId } },
    ]);

    // Transaction à la corbeille : sa pièce disparaît du coffre (mais reste en base pour la restauration).
    await a.call('delete', `/api/v1/transactions/${tx.id}`).expect(204);
    expect((await list()).map((d) => d.id)).not.toContain(piece.id);
    await a.call('get', `/api/v1/documents/${piece.id}/url`).expect(404);
    expect(await prisma.attachment.count({ where: { id: piece.id } })).toBe(1);
  });

  it('dépôt direct : signature vérifiée, fichier manquant, quota', async () => {
    await deposit(EXE, 'facture.pdf').expect(415);
    await a.call('post', '/api/v1/documents').expect(400);
    await prisma.user.update({ where: { id: a.id }, data: { storageQuotaBytes: 0 } });
    await deposit(PDF, 'x.pdf').expect(422);
    await prisma.user.update({ where: { id: a.id }, data: { storageQuotaBytes: 200 * 1024 * 1024 } });
  });

  it('URL signée courte ; download=1 ⇒ téléchargement sous le nom d’origine encodé', async () => {
    const { id } = (await deposit(PDF, "relevé d'août (1).pdf").expect(201)).body;
    const inline = (await a.call('get', `/api/v1/documents/${id}/url`).expect(200)).body.url as string;
    expect(inline).toContain('X-Amz-Expires=300');
    const shown = await fetch(inline);
    expect(shown.headers.get('content-type')).toBe('application/pdf');
    expect(shown.headers.get('content-disposition')).toBeNull();

    const res = await fetch((await a.call('get', `/api/v1/documents/${id}/url?download=1`).expect(200)).body.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''relev%C3%A9%20d%27ao%C3%BBt%20%281%29.pdf");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
  });

  it('tags : remplace l’ensemble, doublons ignorés, tag supprimé retiré, entrée invalide ⇒ 400', async () => {
    const { id } = (await deposit(PDF, 'impots.pdf').expect(201)).body;
    const [t1, t2] = [await newTag('impôts'), await newTag('2026')];
    const { body } = await a.call('put', `/api/v1/documents/${id}/tags`).send({ tagIds: [t1, t2, t1] }).expect(200);
    expect(body.tagIds.sort()).toEqual([t1, t2].sort());
    expect((await a.call('put', `/api/v1/documents/${id}/tags`).send({ tagIds: [t2] }).expect(200)).body.tagIds).toEqual([t2]);

    await a.call('delete', `/api/v1/tags/${t2}`).expect(204);
    expect((await list()).find((d) => d.id === id)?.tagIds).toEqual([]);

    await a.call('put', `/api/v1/documents/${id}/tags`).send({ tagIds: ['pas-un-uuid'] }).expect(400);
    await a.call('put', `/api/v1/documents/${id}/tags`).send({}).expect(400);
  });

  it('suppression : fichier effacé (base + S3) ; une transaction liée perd son justificatif', async () => {
    const tx = (await a.call('post', '/api/v1/transactions').send({ accountId, amountCents: 500, date: '2026-06-02' }).expect(201)).body;
    const piece = (await a.call('post', `/api/v1/transactions/${tx.id}/attachment`).attach('file', PDF, 'ticket.pdf').expect(201)).body;
    const key = await keyOf(piece.id);

    await a.call('delete', `/api/v1/documents/${piece.id}`).expect(204);
    expect((await a.call('get', `/api/v1/transactions/${tx.id}`).expect(200)).body.attachment).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    await a.call('delete', `/api/v1/documents/${piece.id}`).expect(404);
    // La transaction peut de nouveau recevoir une pièce.
    await a.call('post', `/api/v1/transactions/${tx.id}/attachment`).attach('file', PDF, 'ticket.pdf').expect(201);
  });
});
