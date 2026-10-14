import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E10 — transactions. L'isolation A/B de chaque route est dans test/helpers/isolation-registry.ts.
describe('Transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  let groceries: string;
  let housing: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    groceries = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'groceries' } })).id;
    housing = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'housing' } })).id;
    users = await createTwoUsers(app);
    a = users.a;
    accountId = await newAccount();
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  async function newAccount(trackingType = 'NORMAL'): Promise<string> {
    return (await a.call('post', '/api/v1/accounts').send({ name: 'Compte', trackingType }).expect(201)).body.id;
  }
  const create = (body: object) => a.call('post', '/api/v1/transactions').send({ accountId, categoryId: groceries, amountCents: 1234, date: '2026-03-01', ...body });
  const patch = (id: string, body: object) => a.call('patch', `/api/v1/transactions/${id}`).send(body);
  const list = async (query: string) => (await a.call('get', `/api/v1/transactions?${query}`).expect(200)).body as { items: { id: string; date: string }[]; nextCursor: string | null };
  const newTag = async () => (await a.call('post', '/api/v1/tags').send({ name: `t-${Math.random()}` }).expect(201)).body.id as string;

  describe('création', () => {
    it('3 champs + date : DEBIT par défaut, relue à l’identique', async () => {
      const { body } = await a.call('post', '/api/v1/transactions').send({ accountId, categoryId: groceries, amountCents: 1234, date: '2026-03-01' }).expect(201);
      expect(body).toEqual({
        id: expect.any(String),
        accountId,
        name: '',
        date: '2026-03-01',
        amountCents: 1234,
        type: 'DEBIT',
        details: null,
        categoryId: groceries,
        tagIds: [],
        transferId: null,
        recurrenceId: null,
        countInBalance: null,
        attachment: null,
        version: 1,
      });
      expect((await a.call('get', `/api/v1/transactions/${body.id}`).expect(200)).body).toEqual(body);
    });

    it('champs optionnels : type, nom, détails, tags', async () => {
      const [t1, t2] = [await newTag(), await newTag()];
      const { body } = await create({ type: 'CREDIT', name: '  Salaire ', details: 'Mars', tagIds: [t1, t2], amountCents: Number.MAX_SAFE_INTEGER }).expect(201);
      expect(body).toMatchObject({ type: 'CREDIT', name: 'Salaire', details: 'Mars', tagIds: [t1, t2].sort(), amountCents: Number.MAX_SAFE_INTEGER });
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: body.id } })).amountCents).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    });

    it.each([
      ['montant nul', { amountCents: 0 }],
      ['montant décimal', { amountCents: 1.5 }],
      ['montant négatif', { amountCents: -100 }],
      ['montant en texte', { amountCents: '100' }],
      ['montant au-delà de MAX_SAFE_INTEGER', { amountCents: Number.MAX_SAFE_INTEGER + 2 }],
      ['date absente', { date: undefined }],
      ['date inexistante', { date: '2026-02-30' }],
      ['date avec heure', { date: '2026-03-01T10:00:00Z' }],
      ['type TRANSFER (virement = E12)', { type: 'TRANSFER' }],
      ['compte non UUID', { accountId: 'abc' }],
      ['tag en double', { tagIds: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'] }],
      ['champ inconnu', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['transferId (réservé aux virements)', { transferId: '00000000-0000-4000-8000-000000000000' }],
    ])('refusée (400) : %s', async (_, body) => {
      await create(body).expect(400);
    });

    it('compte, catégorie ou tag inconnu ⇒ 404 ; compte supprimé ⇒ 404', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      await create({ accountId: unknown }).expect(404);
      await create({ categoryId: unknown }).expect(404);
      await create({ tagIds: [unknown] }).expect(404);
      const deleted = await newAccount();
      await a.call('delete', `/api/v1/accounts/${deleted}`).expect(204);
      await create({ accountId: deleted }).expect(404);
    });

    it('compte NOT_TRACKED : dépense acceptée, CREDIT ⇒ 422', async () => {
      const wallet = await newAccount('NOT_TRACKED');
      await create({ accountId: wallet }).expect(201);
      await create({ accountId: wallet, type: 'CREDIT' }).expect(422);
    });
  });

  describe('liste paginée', () => {
    it('120 transactions ⇒ 3 pages (50, 50, 20) sans doublon ni trou, dates égales comprises', async () => {
      const acc = await newAccount();
      // 3 dates seulement : les limites de page tombent au milieu de dates égales (départage par id).
      await prisma.transaction.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          userId: a.id,
          accountId: acc,
          categoryId: groceries,
          name: `t${i}`,
          date: new Date(['2026-01-15', '2026-02-15', '2026-03-15'][i % 3]),
          amountCents: 100n,
          type: 'DEBIT' as const,
        })),
      });
      const expected = (
        await prisma.transaction.findMany({ where: { accountId: acc }, orderBy: [{ date: 'desc' }, { id: 'desc' }], select: { id: true } })
      ).map((t) => t.id);

      const pages = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const page = await list(`accountId=${acc}${cursor ? `&cursor=${cursor}` : ''}`);
        pages.push(page.items);
        cursor = page.nextCursor;
      }
      expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
      const ids = pages.flat().map((t) => t.id);
      expect(new Set(ids).size).toBe(120);
      expect(ids).toEqual(expected);
      const dates = pages.flat().map((t) => t.date);
      expect(dates).toEqual([...dates].sort().reverse());

      expect((await list(`accountId=${acc}&limit=7`)).items).toHaveLength(7);
    });

    it('limite et curseur invalides ⇒ 400', async () => {
      await a.call('get', '/api/v1/transactions?limit=0').expect(400);
      await a.call('get', '/api/v1/transactions?limit=101').expect(400);
      await a.call('get', '/api/v1/transactions?limit=abc').expect(400);
      await a.call('get', '/api/v1/transactions?cursor=nimporte-quoi').expect(400);
      await a.call('get', `/api/v1/transactions?cursor=${Buffer.from('2026-01-01|abc').toString('base64url')}`).expect(400);
      await a.call('get', '/api/v1/transactions?from=2026-13-01').expect(400);
    });

    it('filtres date (bornes incluses), compte, catégorie, tag', async () => {
      const acc = await newAccount();
      const tag = await newTag();
      const mk = async (date: string, extra: object = {}) => (await create({ accountId: acc, date, ...extra }).expect(201)).body.id as string;
      const jan = await mk('2026-01-31');
      const feb = await mk('2026-02-01', { categoryId: housing });
      const mar = await mk('2026-03-01', { tagIds: [tag] });
      const ids = async (query: string) => (await list(`accountId=${acc}&${query}`)).items.map((t) => t.id);

      expect(await ids('')).toEqual([mar, feb, jan]);
      expect(await ids('from=2026-02-01&to=2026-03-01')).toEqual([mar, feb]);
      expect(await ids('to=2026-01-31')).toEqual([jan]);
      expect(await ids(`categoryId=${housing}`)).toEqual([feb]);
      expect(await ids(`tagId=${tag}`)).toEqual([mar]);
      expect(await ids(`categoryId=${housing}&tagId=${tag}`)).toEqual([]);
    });
  });

  describe('édition versionnée', () => {
    it('PATCH incrémente la version ; version périmée ⇒ 409, rien d’écrit', async () => {
      const { body: t } = await create({ details: 'avant', tagIds: [await newTag()] }).expect(201);
      const tag = await newTag();
      const { body: v2 } = await patch(t.id, { version: 1, amountCents: 999, date: '2026-04-30', categoryId: housing, name: 'Loyer', details: null, tagIds: [tag], type: 'CREDIT' }).expect(200);
      expect(v2).toEqual({ ...t, amountCents: 999, date: '2026-04-30', categoryId: housing, name: 'Loyer', details: null, tagIds: [tag], type: 'CREDIT', version: 2 });

      await patch(t.id, { version: 1, amountCents: 1 }).expect(409);
      expect((await a.call('get', `/api/v1/transactions/${t.id}`).expect(200)).body).toEqual(v2);

      const { body: v3 } = await patch(t.id, { version: 2, tagIds: [] }).expect(200);
      expect(v3).toEqual({ ...v2, tagIds: [], version: 3 });
    });

    it('PATCH : changement de compte, CREDIT vers NOT_TRACKED ⇒ 422', async () => {
      const { body: t } = await create({ type: 'CREDIT' }).expect(201);
      const other = await newAccount();
      expect((await patch(t.id, { version: 1, accountId: other }).expect(200)).body.accountId).toBe(other);
      const wallet = await newAccount('NOT_TRACKED');
      await patch(t.id, { version: 2, accountId: wallet }).expect(422);
      await patch(t.id, { version: 2, accountId: wallet, type: 'DEBIT' }).expect(200);
    });

    it.each([
      ['sans version', {}],
      ['montant nul', { version: 1, amountCents: 0 }],
      ['montant décimal', { version: 1, amountCents: 1.5 }],
      ['montant négatif', { version: 1, amountCents: -1 }],
      ['nom null', { version: 1, name: null }],
      ['date null', { version: 1, date: null }],
      ['compte null', { version: 1, accountId: null }],
    ])('PATCH refusé (400) : %s', async (_, body) => {
      const { body: t } = await create({}).expect(201);
      await patch(t.id, body).expect(400);
    });
  });

  describe('suppression logique', () => {
    it('supprimée : absente de la liste et de la lecture ; restaurée : de retour', async () => {
      const acc = await newAccount();
      const { body: t } = await create({ accountId: acc }).expect(201);
      await a.call('delete', `/api/v1/transactions/${t.id}`).expect(204);
      expect((await list(`accountId=${acc}`)).items).toEqual([]);
      await a.call('get', `/api/v1/transactions/${t.id}`).expect(404);
      await patch(t.id, { version: 2, name: 'X' }).expect(404);
      await a.call('delete', `/api/v1/transactions/${t.id}`).expect(404);
      expect(await prisma.transaction.count({ where: { id: t.id } })).toBe(1);

      const { body: restored } = await a.call('post', `/api/v1/transactions/${t.id}/restore`).expect(200);
      expect(restored).toEqual({ ...t, version: 3 });
      expect((await list(`accountId=${acc}`)).items.map((x) => x.id)).toEqual([t.id]);
      await a.call('post', `/api/v1/transactions/${t.id}/restore`).expect(404);
    });

    it('compte supprimé : ses transactions sont masquées, puis visibles après restauration du compte', async () => {
      const acc = await newAccount();
      const { body: t } = await create({ accountId: acc }).expect(201);
      await a.call('delete', `/api/v1/accounts/${acc}`).expect(204);
      await a.call('get', `/api/v1/transactions/${t.id}`).expect(404);
      expect((await list('limit=100')).items.map((x) => x.id)).not.toContain(t.id);
      await a.call('get', `/api/v1/transactions?accountId=${acc}`).expect(404);
      await a.call('post', `/api/v1/accounts/${acc}/restore`).expect(200);
      expect((await a.call('get', `/api/v1/transactions/${t.id}`).expect(200)).body).toEqual(t);
    });
  });

  it('identifiant inconnu ⇒ 404, non UUID ⇒ 400, sans session ⇒ 401', async () => {
    await a.call('get', '/api/v1/transactions/00000000-0000-4000-8000-000000000000').expect(404);
    await a.call('get', '/api/v1/transactions/pas-un-uuid').expect(400);
    await request(app.getHttpServer()).get('/api/v1/transactions').expect(401);
  });
});
