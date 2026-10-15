import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CategoryDto } from '@budgetracker/shared';
import { seed } from '../../prisma/seed';
import { grantAdmin } from '../../scripts/grant-admin';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E38 — catégories globales gérées par l'administrateur (SPEC §13.3). A est admin, B un utilisateur ordinaire.
describe('Administration : catégories globales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let b: TestUser;
  const created: string[] = [];
  // Catégories globales partagées avec les autres suites en parallèle : noms uniques par exécution.
  const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
  });

  beforeEach(async () => {
    users = await createTwoUsers(app);
    ({ a, b } = users);
    await grantAdmin(prisma, (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).email);
  });

  // Utilisateurs d'abord (leurs transactions partent en cascade), puis les globales créées et leur journal.
  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId: a.id } });
    await users.cleanup();
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: [a.id, ...created] } } });
    await prisma.category.deleteMany({ where: { parentId: { in: created } } });
    await prisma.category.deleteMany({ where: { id: { in: created.splice(0) } } });
  });

  afterAll(() => app.close());

  const create = async (body: object, status: number) => {
    const res = await a.call('post', '/api/v1/admin/categories').send(body).expect(status);
    if (status === 201) created.push(res.body.id);
    return res;
  };
  const list = async (user: TestUser) => (await user.call('get', '/api/v1/categories').expect(200)).body as CategoryDto[];
  const logs = async (targetId: string) =>
    (await prisma.adminAuditLog.findMany({ where: { targetId }, orderBy: { createdAt: 'asc' } })).map(({ adminId, action }) => ({ adminId, action }));

  it('création par l’admin : visible de A et B dans leurs listes, journalisée', async () => {
    const name = unique('Aide sociale');
    const { body } = await create({ name: `  ${name} `, color: '#12AB34' }, 201);
    const expected: CategoryDto = { id: body.id, parentId: null, system: true, nameKey: null, name, color: '#12AB34', hidden: false, customName: null, archived: false };
    expect(body).toEqual(expected);
    expect(await list(a)).toContainEqual(expected);
    expect(await list(b)).toContainEqual(expected);
    expect((await a.call('get', '/api/v1/admin/categories').expect(200)).body).toContainEqual(expected);

    // Sous-catégorie globale, utilisable par B ; B ne peut ni la modifier ni la supprimer (catégorie système).
    const { body: child } = await create({ name: 'Allocations', parentId: body.id }, 201);
    expect(child).toMatchObject({ parentId: body.id, system: true, name: 'Allocations' });
    await b.call('patch', `/api/v1/categories/${child.id}`).send({ name: 'X' }).expect(403);
    await b.call('delete', `/api/v1/categories/${child.id}`).expect(403);

    expect(await logs(body.id)).toEqual([{ adminId: a.id, action: 'CATEGORY_CREATED' }]);
    expect(await logs(child.id)).toEqual([{ adminId: a.id, action: 'CATEGORY_CREATED' }]);
  });

  it('deux niveaux max ; parent technique, perso ou inconnu refusé', async () => {
    const { body: root } = await create({ name: unique('Racine') }, 201);
    const { body: child } = await create({ name: 'Enfant', parentId: root.id }, 201);
    await create({ name: 'Petit-enfant', parentId: child.id }, 422);
    // Une catégorie seedée sert de parent comme une autre globale.
    const sport = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'sport' } });
    await create({ name: unique('Escalade'), parentId: sport.id }, 201);
    const technical = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'transfer' } });
    await create({ name: 'Sous-virement', parentId: technical.id }, 422);
    const { body: personal } = await b.call('post', '/api/v1/categories').send({ name: 'Perso de B' }).expect(201);
    await create({ name: 'Sous-perso', parentId: personal.id }, 404);
    await create({ name: '   ' }, 400);
    await create({ name: 'X', userId: b.id }, 400);
  });

  it('doublon de nom refusé entre sœurs (casse et espaces ignorés), accepté sous un autre parent', async () => {
    const name = unique('Dons');
    const { body: root } = await create({ name }, 201);
    await create({ name: `  ${name.toUpperCase()} ` }, 409);
    await create({ name: 'Associations', parentId: root.id }, 201);
    await create({ name: 'associations', parentId: root.id }, 409);
    const { body: other } = await create({ name: unique('Autre') }, 201);
    await create({ name: 'Associations', parentId: other.id }, 201);
    // Renommer vers un nom déjà pris : même refus.
    await a.call('patch', `/api/v1/admin/categories/${other.id}`).send({ name }).expect(409);
    expect(await logs(other.id)).toEqual([{ adminId: a.id, action: 'CATEGORY_CREATED' }]);
  });

  it('renommage : B voit le nouveau nom ; journalisé', async () => {
    const { body } = await create({ name: unique('Ancien') }, 201);
    const name = unique('Nouveau');
    const { body: renamed } = await a.call('patch', `/api/v1/admin/categories/${body.id}`).send({ name }).expect(200);
    expect(renamed).toEqual({ ...body, name });
    expect(await list(b)).toContainEqual(renamed);
    expect(await logs(body.id)).toEqual([
      { adminId: a.id, action: 'CATEGORY_CREATED' },
      { adminId: a.id, action: 'CATEGORY_UPDATED' },
    ]);
  });

  it('archivage : reste listée (marquée) et sur les transactions existantes, plus de nouvelle sous-catégorie ; restauration', async () => {
    const { body: root } = await create({ name: unique('Éphémère') }, 201);
    const { body: account } = await b.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201);
    const { body: tx } = await b
      .call('post', '/api/v1/transactions')
      .send({ accountId: account.id, categoryId: root.id, amountCents: 1500, date: '2026-05-01' })
      .expect(201);

    const { body: archived } = await a.call('patch', `/api/v1/admin/categories/${root.id}`).send({ archived: true }).expect(200);
    expect(archived).toEqual({ ...root, archived: true });
    expect(await list(b)).toContainEqual(archived); // nom encore affiché dans l'historique ; le front l'exclut des listes de saisie
    expect((await b.call('get', `/api/v1/transactions/${tx.id}`).expect(200)).body).toEqual(tx);
    const { body: stats } = await b.call('get', '/api/v1/stats/by-category?from=2026-05-01&to=2026-05-31').expect(200);
    expect(stats).toContainEqual({ categoryId: root.id, incomeCents: 0, expenseCents: 1500 });
    await b.call('post', '/api/v1/categories').send({ name: 'Sous-perso', parentId: root.id }).expect(422);
    await create({ name: 'Sous-globale', parentId: root.id }, 422);

    // Archiver deux fois : idempotent, une seule entrée au journal.
    await a.call('patch', `/api/v1/admin/categories/${root.id}`).send({ archived: true }).expect(200);
    const { body: restored } = await a.call('patch', `/api/v1/admin/categories/${root.id}`).send({ archived: false }).expect(200);
    expect(restored).toEqual(root);
    await b.call('post', '/api/v1/categories').send({ name: 'Sous-perso', parentId: root.id }).expect(201);
    expect(await logs(root.id)).toEqual([
      { adminId: a.id, action: 'CATEGORY_CREATED' },
      { adminId: a.id, action: 'CATEGORY_ARCHIVED' },
      { adminId: a.id, action: 'CATEGORY_RESTORED' },
    ]);
  });

  it('catégorie technique non modifiable ; catégorie perso ou inconnue ⇒ 404', async () => {
    const opening = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'opening_balance' } });
    await a.call('patch', `/api/v1/admin/categories/${opening.id}`).send({ archived: true }).expect(422);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: opening.id } })).archivedAt).toBeNull();
    const { body: personal } = await b.call('post', '/api/v1/categories').send({ name: 'Perso de B' }).expect(201);
    await a.call('patch', `/api/v1/admin/categories/${personal.id}`).send({ name: 'Volée' }).expect(404);
    await a.call('patch', '/api/v1/admin/categories/00000000-0000-4000-8000-000000000000').send({ name: 'X' }).expect(404);
    expect((await a.call('get', '/api/v1/admin/categories').expect(200)).body.map((c: CategoryDto) => c.id)).not.toContain(personal.id);
  });

  it('utilisateur non admin ⇒ 403, rien créé ni journalisé', async () => {
    const name = unique('Interdite');
    await b.call('get', '/api/v1/admin/categories').expect(403);
    await b.call('post', '/api/v1/admin/categories').send({ name }).expect(403);
    const { body: root } = await create({ name: unique('Cible') }, 201);
    await b.call('patch', `/api/v1/admin/categories/${root.id}`).send({ archived: true }).expect(403);
    expect(await prisma.category.count({ where: { name } })).toBe(0);
    expect(await logs(root.id)).toEqual([{ adminId: a.id, action: 'CATEGORY_CREATED' }]);
  });

  it('suppression : inutilisée ⇒ 204, disparaît pour tous, préférences emportées, journalisée', async () => {
    const { body } = await create({ name: unique('Éphémère') }, 201);
    await b.call('put', `/api/v1/categories/${body.id}/preference`).send({ hidden: true }).expect(200);
    await a.call('delete', `/api/v1/admin/categories/${body.id}`).expect(204);
    for (const user of [a, b]) expect((await list(user)).map((c) => c.id)).not.toContain(body.id);
    expect(await prisma.userCategoryPreference.count({ where: { categoryId: body.id } })).toBe(0);
    expect(await logs(body.id)).toEqual([
      { adminId: a.id, action: 'CATEGORY_CREATED' },
      { adminId: a.id, action: 'CATEGORY_DELETED' },
    ]);
    await a.call('delete', `/api/v1/admin/categories/${body.id}`).expect(404);
  });

  it('suppression refusée (409) si utilisée par une transaction (même supprimée), une récurrence ou une sous-catégorie, perso comprise', async () => {
    const { body: account } = await b.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201);
    const { body: used } = await create({ name: unique('Utilisée') }, 201);
    const { body: tx } = await b.call('post', '/api/v1/transactions').send({ accountId: account.id, categoryId: used.id, amountCents: 100, date: '2026-10-01', name: 'x' }).expect(201);
    await b.call('delete', `/api/v1/transactions/${tx.id}`).expect(204);
    await a.call('delete', `/api/v1/admin/categories/${used.id}`).expect(409);

    const { body: templated } = await create({ name: unique('Récurrente') }, 201);
    await b.call('post', '/api/v1/recurrences').send({ accountId: account.id, interval: 1, unit: 'MONTH', startDate: '2030-01-01', template: { categoryId: templated.id, amountCents: 900 } }).expect(201);
    await a.call('delete', `/api/v1/admin/categories/${templated.id}`).expect(409);

    const { body: parent } = await create({ name: unique('Parent') }, 201);
    await b.call('post', '/api/v1/categories').send({ name: 'Sous perso', parentId: parent.id }).expect(201);
    await a.call('delete', `/api/v1/admin/categories/${parent.id}`).expect(409);

    expect(await prisma.category.count({ where: { id: { in: [used.id, templated.id, parent.id] } } })).toBe(3);
  });

  it('suppression : catégorie du seed ⇒ 422 (le seed la recréerait), technique ⇒ 422, perso ou inconnue ⇒ 404, non admin ⇒ 403', async () => {
    const seeded = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'sport' } });
    const technical = await prisma.category.findUniqueOrThrow({ where: { nameKey: 'transfer' } });
    await a.call('delete', `/api/v1/admin/categories/${seeded.id}`).expect(422);
    await a.call('delete', `/api/v1/admin/categories/${technical.id}`).expect(422);
    const { body: own } = await b.call('post', '/api/v1/categories').send({ name: 'Perso de B' }).expect(201);
    await a.call('delete', `/api/v1/admin/categories/${own.id}`).expect(404);
    await a.call('delete', '/api/v1/admin/categories/00000000-0000-4000-8000-000000000000').expect(404);
    const { body } = await create({ name: unique('Protégée') }, 201);
    await b.call('delete', `/api/v1/admin/categories/${body.id}`).expect(403);
    expect(await prisma.category.count({ where: { id: { in: [seeded.id, own.id, body.id] } } })).toBe(3);
  });

  it('suppression : suggestion en attente dessous ⇒ 409 ; traitée ⇒ gardée sans parent', async () => {
    const { body: parent } = await create({ name: unique('Parent sugg') }, 201);
    const name = unique('Proposée');
    await b.call('post', '/api/v1/categories').send({ name, parentId: parent.id, suggest: true }).expect(201);
    const [s] = (await b.call('get', '/api/v1/categories/suggestions').expect(200)).body;
    // La catégorie perso proposée est elle-même une sous-catégorie : la supprimer d'abord.
    const own = (await list(b)).find((c) => c.name === name)!;
    await b.call('delete', `/api/v1/categories/${own.id}`).expect(204);
    await a.call('delete', `/api/v1/admin/categories/${parent.id}`).expect(409);
    await a.call('post', `/api/v1/admin/category-suggestions/${s.id}/resolve`).send({ decision: 'REJECTED' }).expect(200);
    await a.call('delete', `/api/v1/admin/categories/${parent.id}`).expect(204);
    expect((await b.call('get', '/api/v1/categories/suggestions').expect(200)).body).toEqual([{ ...s, parentId: null, status: 'REJECTED', treatedAt: expect.any(String) }]);
  });
});
