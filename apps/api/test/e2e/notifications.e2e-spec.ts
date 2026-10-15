import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationsDto } from '@budgetracker/shared';
import { grantAdmin } from '../../scripts/grant-admin';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E40 — notifications (cloche) et annonces (SPEC §13.6). A est admin, B un utilisateur ordinaire.
// Les annonces sont globales : seule cette suite en crée de visibles (gdpr.e2e-spec.ts les date de 2000),
// donc les compteurs des utilisateurs créés ici sont exacts.
describe('Notifications et annonces (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let b: TestUser;
  const announcements: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    users = await createTwoUsers(app);
    ({ a, b } = users);
    await grantAdmin(prisma, await emailOf(a));
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminId: a.id }, { targetId: a.id }] } });
    await prisma.announcement.deleteMany({ where: { id: { in: announcements.splice(0) } } });
    await users.cleanup();
  });

  afterAll(() => app.close());

  const emailOf = async (user: TestUser) => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email;
  const inbox = async (user: TestUser) => (await user.call('get', '/api/v1/notifications').expect(200)).body as NotificationsDto;
  const read = (user: TestUser, id: string) => user.call('post', `/api/v1/notifications/${id}/read`);
  const announce = async (message: string) => {
    const { body } = await a.call('post', '/api/v1/admin/announcements').send({ message }).expect(201);
    announcements.push(body.id);
    return body as { id: string; message: string; createdAt: string };
  };

  it('annonce de l’admin : visible de tous, texte brut, lue indépendamment par chaque utilisateur, compteur exact', async () => {
    const message = '<b>Nouvelle</b> catégorie « Aide sociale »';
    const sent = await announce(`  ${message}  `);
    expect(sent).toEqual({ id: expect.any(String), message, createdAt: expect.stringMatching(/Z$/) });
    const item = { id: sent.id, kind: 'ANNOUNCEMENT', message, createdAt: sent.createdAt, read: false };
    expect(await inbox(a)).toEqual({ unreadCount: 1, items: [item] });
    expect(await inbox(b)).toEqual({ unreadCount: 1, items: [item] });

    await read(b, sent.id).expect(204);
    await read(b, sent.id).expect(204); // idempotent
    expect(await inbox(b)).toEqual({ unreadCount: 0, items: [{ ...item, read: true }] });
    expect(await inbox(a)).toEqual({ unreadCount: 1, items: [item] });
    // Un seul enregistrement d'annonce, une lecture par utilisateur.
    expect(await prisma.announcement.count({ where: { id: sent.id } })).toBe(1);
    expect(await prisma.announcementRead.findMany({ where: { announcementId: sent.id }, select: { userId: true } })).toEqual([{ userId: b.id }]);
    expect(await prisma.adminAuditLog.findMany({ where: { targetId: sent.id }, select: { adminId: true, action: true } })).toEqual([{ adminId: a.id, action: 'ANNOUNCEMENT_SENT' }]);
  });

  it('un nouvel inscrit ne reçoit pas les annonces antérieures à son inscription', async () => {
    const before = await announce('Avant');
    const late = await createTwoUsers(app);
    try {
      const after = await announce('Après');
      expect((await inbox(late.a)).items.map((n) => n.id)).toEqual([after.id]);
      expect((await inbox(late.a)).unreadCount).toBe(1);
      await read(late.a, before.id).expect(404);
      expect((await inbox(b)).items.map((n) => n.id)).toEqual([after.id, before.id]);
    } finally {
      await late.cleanup();
    }
  });

  it('notification ciblée : visible du seul destinataire, 404 pour les autres, journalisée sans e-mail', async () => {
    const email = await emailOf(b);
    const { body: sent } = await a.call('post', '/api/v1/admin/notifications').send({ email: `  ${email.toUpperCase()} `, message: 'Merci pour ton retour' }).expect(201);
    expect(sent).toEqual({ id: expect.any(String), message: 'Merci pour ton retour', createdAt: expect.stringMatching(/Z$/) });
    expect(JSON.stringify(sent)).not.toContain('@');

    expect(await inbox(b)).toEqual({ unreadCount: 1, items: [{ id: sent.id, kind: 'PERSONAL', message: 'Merci pour ton retour', createdAt: sent.createdAt, read: false }] });
    expect(await inbox(a)).toEqual({ unreadCount: 0, items: [] });
    await read(a, sent.id).expect(404);
    expect((await inbox(b)).unreadCount).toBe(1);
    await read(b, sent.id).expect(204);
    expect((await inbox(b)).unreadCount).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: sent.id } })).readAt).not.toBeNull();

    const logs = await prisma.adminAuditLog.findMany({ where: { targetId: sent.id } });
    expect(logs.map(({ adminId, action }) => ({ adminId, action }))).toEqual([{ adminId: a.id, action: 'NOTIFICATION_SENT' }]);
    expect(JSON.stringify(logs)).not.toContain('@');

    await a.call('post', '/api/v1/admin/notifications').send({ email: 'inconnu@example.test', message: 'x' }).expect(404);
    await read(b, '00000000-0000-4000-8000-000000000000').expect(404);
    await read(b, 'pas-un-uuid').expect(400);
  });

  it('ordre : non lues d’abord, puis les plus récentes ; compteur = annonces + notifications non lues', async () => {
    const first = await announce('Première');
    const n1 = await prisma.notification.create({ data: { userId: b.id, message: 'Perso 1' } });
    const second = await announce('Deuxième');
    const n2 = await prisma.notification.create({ data: { userId: b.id, message: 'Perso 2' } });
    const ids = async () => (await inbox(b)).items.map((n) => n.id);
    expect(await ids()).toEqual([n2.id, second.id, n1.id, first.id]);
    expect((await inbox(b)).unreadCount).toBe(4);

    await read(b, n2.id).expect(204);
    await read(b, second.id).expect(204);
    expect(await ids()).toEqual([n1.id, first.id, n2.id, second.id]);
    expect((await inbox(b)).unreadCount).toBe(2);
  });

  it('non admin ⇒ 403 sur l’envoi d’annonce et de notification, rien de créé', async () => {
    const email = await emailOf(a);
    await b.call('post', '/api/v1/admin/announcements').send({ message: 'Pirate' }).expect(403);
    await b.call('post', '/api/v1/admin/notifications').send({ email, message: 'Pirate' }).expect(403);
    expect(await inbox(a)).toEqual({ unreadCount: 0, items: [] });
    expect(await prisma.announcement.count({ where: { message: 'Pirate' } })).toBe(0);
  });

  it('message vide, trop long, e-mail invalide ou champ en trop ⇒ 400 ; 2000 caractères acceptés', async () => {
    const email = await emailOf(b);
    for (const bad of [{ message: '' }, { message: '   ' }, { message: 'x'.repeat(2001) }, {}, { message: 'x', kind: 'PERSONAL' }])
      await a.call('post', '/api/v1/admin/announcements').send(bad).expect(400);
    for (const bad of [{ email, message: '' }, { email: 'pas-un-email', message: 'x' }, { message: 'x' }, { email, message: 'x', userId: b.id }])
      await a.call('post', '/api/v1/admin/notifications').send(bad).expect(400);
    expect(await inbox(b)).toEqual({ unreadCount: 0, items: [] });
    await announce('x'.repeat(2000));
    await a.call('post', '/api/v1/admin/notifications').send({ email, message: 'x'.repeat(2000) }).expect(201);
    expect((await inbox(b)).unreadCount).toBe(2);
  });

  it('suppression du compte : notifications et lectures partent avec lui, l’annonce reste', async () => {
    const sent = await announce('Annonce');
    await prisma.notification.create({ data: { userId: b.id, message: 'Perso' } });
    await read(b, sent.id).expect(204);
    await b.call('delete', '/api/v1/me').expect(204);
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0);
    expect(await prisma.announcementRead.count({ where: { userId: b.id } })).toBe(0);
    expect(await prisma.announcement.count({ where: { id: sent.id } })).toBe(1);
  });
});
