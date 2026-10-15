import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminFeedbackDto, FeedbackDto } from '@budgetracker/shared';
import { grantAdmin } from '../../scripts/grant-admin';
import { AppModule } from '../../src/app.module';
import { PurgeJob } from '../../src/jobs/purge.job';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E39 — retours utilisateurs et boîte de réception admin (SPEC §13.5). A est admin, B un utilisateur ordinaire.
// La boîte est globale (autres suites en parallèle) : les assertions portent sur les retours créés ici.
describe('Retours utilisateurs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let b: TestUser;
  const NOW = new Date();
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    users = await createTwoUsers(app);
    ({ a, b } = users);
    await grantAdmin(prisma, (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).email);
  });

  // Retours en cascade avec leurs auteurs ; journal de l'admin A retiré à part (sinon il resterait sans auteur).
  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminId: a.id }, { targetId: a.id }] } });
    await users.cleanup();
  });

  afterAll(() => app.close());

  const send = (user: TestUser, body: object) => user.call('post', '/api/v1/feedback').send(body);
  const mine = async (user: TestUser) => (await user.call('get', '/api/v1/feedback').expect(200)).body as FeedbackDto[];
  const inbox = async (query = '') => (await a.call('get', `/api/v1/admin/feedback${query}`).expect(200)).body as AdminFeedbackDto[];
  /** Retours insérés directement (antidatés), hors limites de l'API. */
  const insert = (userId: string, n: number, data: { createdAt?: Date; treatedAt?: Date | null; type?: 'OPINION' | 'IDEA' | 'PROBLEM' } = {}) =>
    prisma.feedback.createManyAndReturn({ data: Array.from({ length: n }, (_, i) => ({ userId, type: 'OPINION' as const, message: `Ancien ${i}`, ...data })) });

  it('envoi : texte brut conservé tel quel, chacun ne voit que ses propres retours', async () => {
    const message = '<script>alert(1)</script> <b>gras</b>';
    const { body } = await send(b, { type: 'PROBLEM', message: `  ${message}  ` }).expect(201);
    expect(body).toEqual({ id: expect.any(String), type: 'PROBLEM', message, status: 'NEW', createdAt: expect.stringMatching(/Z$/), treatedAt: null });
    expect(await mine(b)).toEqual([body]);
    expect(await mine(a)).toEqual([]);
  });

  it('vide, espaces seuls, trop long, type inconnu ou champ en trop ⇒ 400 ; 2000 caractères acceptés', async () => {
    for (const bad of [{ type: 'IDEA', message: '' }, { type: 'IDEA', message: '   ' }, { type: 'IDEA', message: 'x'.repeat(2001) }, { type: 'BUG', message: 'x' }, { message: 'x' }, { type: 'IDEA', message: 'x', status: 'TREATED' }])
      await send(b, bad).expect(400);
    expect(await mine(b)).toEqual([]);
    await send(b, { type: 'IDEA', message: 'x'.repeat(2000) }).expect(201);
  });

  it('5 retours par 24 h : le 6ᵉ ⇒ 429 ; ceux de plus de 24 h ne comptent pas', async () => {
    await insert(b.id, 3, { createdAt: ago(1.05), treatedAt: ago(1) });
    for (let i = 0; i < 5; i++) await send(b, { type: 'IDEA', message: `Idée ${i}` }).expect(201);
    await send(b, { type: 'IDEA', message: 'Une de trop' }).expect(429);
    expect(await mine(b)).toHaveLength(8);
    await send(a, { type: 'IDEA', message: 'A n’est pas limité par B' }).expect(201);
  });

  it('20 retours non traités au plus : le 21ᵉ ⇒ 429, accepté dès que l’admin en traite un', async () => {
    const [first] = await insert(b.id, 20, { createdAt: ago(2) });
    await send(b, { type: 'OPINION', message: 'Le 21ᵉ' }).expect(429);
    await a.call('post', `/api/v1/admin/feedback/${first.id}/treat`).expect(200);
    await send(b, { type: 'OPINION', message: 'Le 21ᵉ' }).expect(201);
  });

  it('envois simultanés : jamais plus de 5 en 24 h', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(b, { type: 'IDEA', message: `Rafale ${i}` })));
    expect(results.map((r) => r.status).sort()).toEqual([...Array(5).fill(201), ...Array(5).fill(429)]);
    expect(await mine(b)).toHaveLength(5);
  });

  it('boîte de réception : filtres type et statut, tris, traitement journalisé et idempotent, sans auteur', async () => {
    const { body: idea } = await send(b, { type: 'IDEA', message: 'Idée' }).expect(201);
    const { body: bug } = await send(b, { type: 'PROBLEM', message: '<i>Bug</i>' }).expect(201);
    const { body: opinion } = await send(a, { type: 'OPINION', message: 'Avis' }).expect(201);
    const ids = [idea.id, bug.id, opinion.id];
    const ours = (list: AdminFeedbackDto[]) => list.filter((f) => ids.includes(f.id)).map((f) => f.id);

    const all = await inbox();
    expect(ours(all)).toEqual([opinion.id, bug.id, idea.id]); // plus récent d'abord
    const row = all.find((f) => f.id === bug.id)!;
    expect(row).toEqual({ ...bug, expiresAt: expect.any(String), expiringSoon: false });
    expect(Object.keys(row)).not.toContain('userId');
    expect(JSON.stringify(all)).not.toMatch(/@|userId/);

    const { body: treated } = await a.call('post', `/api/v1/admin/feedback/${bug.id}/treat`).expect(200);
    expect(treated).toMatchObject({ id: bug.id, status: 'TREATED', treatedAt: expect.stringMatching(/Z$/), expiringSoon: false });
    expect(Date.parse(treated.expiresAt) - Date.parse(treated.treatedAt)).toBe(30 * 86_400_000);
    // Deuxième traitement : même date, une seule entrée au journal.
    expect((await a.call('post', `/api/v1/admin/feedback/${bug.id}/treat`).expect(200)).body).toEqual(treated);
    expect(await prisma.adminAuditLog.findMany({ where: { targetId: bug.id }, select: { adminId: true, action: true } })).toEqual([{ adminId: a.id, action: 'FEEDBACK_TREATED' }]);
    expect((await mine(b)).find((f) => f.id === bug.id)).toMatchObject({ status: 'TREATED', treatedAt: treated.treatedAt });

    expect(ours(await inbox('?type=PROBLEM'))).toEqual([bug.id]);
    expect(ours(await inbox('?status=NEW'))).toEqual([opinion.id, idea.id]);
    expect(ours(await inbox('?status=TREATED'))).toEqual([bug.id]);
    expect(ours(await inbox('?type=IDEA&status=TREATED'))).toEqual([]);
    expect(ours(await inbox('?sort=type'))).toEqual([opinion.id, idea.id, bug.id]); // avis, idée, problème
    expect(ours(await inbox('?sort=status'))).toEqual([opinion.id, idea.id, bug.id]); // nouveaux d'abord
    for (const bad of ['?type=BUG', '?status=DONE', '?sort=userId']) await a.call('get', `/api/v1/admin/feedback${bad}`).expect(400);

    await a.call('post', '/api/v1/admin/feedback/00000000-0000-4000-8000-000000000000/treat').expect(404);
  });

  it('non admin ⇒ 403 sur la boîte et le traitement, rien de modifié', async () => {
    const { body } = await send(b, { type: 'IDEA', message: 'Idée' }).expect(201);
    await b.call('get', '/api/v1/admin/feedback').expect(403);
    await b.call('post', `/api/v1/admin/feedback/${body.id}/treat`).expect(403);
    expect(await mine(b)).toEqual([body]);
  });

  it('avertissement : non traité à moins de 7 jours de la suppression (90 j)', async () => {
    const [soon, later, treated] = [...(await insert(b.id, 1, { createdAt: ago(84) })), ...(await insert(b.id, 1, { createdAt: ago(82) })), ...(await insert(b.id, 1, { createdAt: ago(89), treatedAt: ago(1) }))];
    const rows = (await inbox()).filter((f) => [soon.id, later.id, treated.id].includes(f.id));
    expect(Object.fromEntries(rows.map((f) => [f.id, f.expiringSoon]))).toEqual({ [soon.id]: true, [later.id]: false, [treated.id]: false });
    expect(rows.find((f) => f.id === soon.id)!.expiresAt).toBe(new Date(ago(84).getTime() + 90 * 86_400_000).toISOString());
  });

  it('purge (horloge injectée) : traité il y a 29 j conservé, 31 j supprimé ; non traité 89 j conservé, 91 j supprimé', async () => {
    const [t29] = await insert(b.id, 1, { createdAt: ago(100), treatedAt: ago(29) });
    const [t31] = await insert(b.id, 1, { createdAt: ago(40), treatedAt: ago(31) });
    const [n89] = await insert(b.id, 1, { createdAt: ago(89) });
    const [n91] = await insert(b.id, 1, { createdAt: ago(91) });

    // Pas d'assertion sur le compteur : purge.e2e-spec.ts purge aussi en parallèle (la purge est globale).
    await app.get(PurgeJob).purge(NOW);

    const left = (await prisma.feedback.findMany({ where: { id: { in: [t29.id, t31.id, n89.id, n91.id] } } })).map((f) => f.id).sort();
    expect(left).toEqual([t29.id, n89.id].sort());
  });

  it('suppression du compte : ses retours partent avec lui', async () => {
    await send(b, { type: 'IDEA', message: 'Idée' }).expect(201);
    await b.call('delete', '/api/v1/me').expect(204);
    expect(await prisma.feedback.count({ where: { userId: b.id } })).toBe(0);
  });
});
