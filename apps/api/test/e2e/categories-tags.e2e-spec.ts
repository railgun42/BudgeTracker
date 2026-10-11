import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E9 — catégories et tags. L'isolation A/B de chaque route est dans test/helpers/isolation-registry.ts.
describe('Catégories et tags (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let accountId: string;
  const system: Record<string, string> = {}; // nameKey ⇒ id

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    for (const c of await prisma.category.findMany({ where: { userId: null } })) system[c.nameKey!] = c.id;
    users = await createTwoUsers(app);
    a = users.a;
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const createCategory = (body: object) => a.call('post', '/api/v1/categories').send(body);
  const patchCategory = (id: string, body: object) => a.call('patch', `/api/v1/categories/${id}`).send(body);
  const deleteCategory = (id: string, reassignTo?: string) =>
    a.call('delete', `/api/v1/categories/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`);
  const listCategories = async () => (await a.call('get', '/api/v1/categories').expect(200)).body as { id: string }[];
  // Pas encore d'endpoint transactions (E10) : insertion directe.
  const addTransaction = (categoryId: string, deletedAt: Date | null = null) =>
    prisma.transaction.create({
      data: { userId: a.id, accountId, categoryId, name: 'Achat', date: new Date('2026-03-01'), amountCents: 100n, type: 'DEBIT', deletedAt },
    });

  describe('catégories', () => {
    it('liste les catégories système (lecture seule, 2 niveaux) et les perso', async () => {
      const { body: mine } = await createCategory({ name: '  Vacances  ', color: '#AbCdEf' }).expect(201);
      expect(mine).toEqual({ id: expect.any(String), parentId: null, system: false, nameKey: null, name: 'Vacances', color: '#AbCdEf' });
      const list = await listCategories();
      expect(list).toContainEqual(mine);
      expect(list).toContainEqual({ id: system.groceries, parentId: null, system: true, nameKey: 'groceries', name: null, color: null });
      expect(list).toContainEqual({ id: system['groceries.food'], parentId: system.groceries, system: true, nameKey: 'groceries.food', name: null, color: null });
    });

    it('sous-catégorie sous une racine perso ou système ; 3e niveau ⇒ 422', async () => {
      const { body: root } = await createCategory({ name: 'Loisirs' }).expect(201);
      const { body: child } = await createCategory({ name: 'Cinéma', parentId: root.id }).expect(201);
      expect(child.parentId).toBe(root.id);
      const { body: underSystem } = await createCategory({ name: 'Bio', parentId: system.groceries }).expect(201);
      expect(underSystem.parentId).toBe(system.groceries);

      await createCategory({ name: 'Trop profond', parentId: child.id }).expect(422);
      await createCategory({ name: 'Trop profond', parentId: system['groceries.food'] }).expect(422);
      await createCategory({ name: 'Parent inconnu', parentId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    });

    it.each([
      ['nom vide', { name: '   ' }],
      ['nom trop long', { name: 'x'.repeat(101) }],
      ['couleur invalide', { name: 'X', color: 'red' }],
      ['parentId non UUID', { name: 'X', parentId: 'abc' }],
      ['nameKey (réservé au système)', { name: 'X', nameKey: 'interest' }],
      ['userId', { name: 'X', userId: '00000000-0000-4000-8000-000000000000' }],
    ])('création refusée (400) : %s', async (_, body) => {
      await createCategory(body).expect(400);
    });

    it('PATCH : renomme, recolore, déplace ; 2 niveaux préservés', async () => {
      const { body: cat } = await createCategory({ name: 'Auto', color: '#000000' }).expect(201);
      const { body: other } = await createCategory({ name: 'Transport' }).expect(201);
      const { body: otherChild } = await createCategory({ name: 'Train', parentId: other.id }).expect(201);

      expect((await patchCategory(cat.id, { name: 'Voiture', color: null }).expect(200)).body).toEqual({ ...cat, name: 'Voiture', color: null });
      expect((await patchCategory(cat.id, { parentId: other.id }).expect(200)).body.parentId).toBe(other.id);
      expect((await patchCategory(cat.id, { parentId: null }).expect(200)).body.parentId).toBeNull();

      await patchCategory(cat.id, { parentId: cat.id }).expect(422); // son propre parent
      await patchCategory(cat.id, { parentId: otherChild.id }).expect(422); // 3e niveau
      await patchCategory(other.id, { parentId: cat.id }).expect(422); // a des enfants
      await patchCategory(cat.id, { name: null }).expect(400);
      await patchCategory(cat.id, { name: '' }).expect(400);
    });

    it('catégorie système : PATCH et DELETE ⇒ 403, inchangée', async () => {
      const before = await prisma.category.findUniqueOrThrow({ where: { id: system.housing } });
      await patchCategory(system.housing, { name: 'Maison' }).expect(403);
      await patchCategory(system['housing.rent'], { color: '#ffffff' }).expect(403);
      await deleteCategory(system.housing).expect(403);
      await deleteCategory(system.cash, system.housing).expect(403);
      expect(await prisma.category.findUniqueOrThrow({ where: { id: system.housing } })).toEqual(before);
    });

    it('suppression d’une catégorie inutilisée ⇒ 204, absente de la liste', async () => {
      const { body: cat } = await createCategory({ name: 'Inutile' }).expect(201);
      await deleteCategory(cat.id).expect(204);
      expect((await listCategories()).map((c) => c.id)).not.toContain(cat.id);
      await deleteCategory(cat.id).expect(404);
    });

    it('catégorie utilisée sans cible ⇒ 409 ; avec cible ⇒ transactions réaffectées (supprimées logiquement comprises)', async () => {
      const { body: cat } = await createCategory({ name: 'Resto' }).expect(201);
      const { body: target } = await createCategory({ name: 'Sorties' }).expect(201);
      const live = await addTransaction(cat.id);
      const deleted = await addTransaction(cat.id, new Date());

      await deleteCategory(cat.id).expect(409);
      expect(await prisma.transaction.count({ where: { categoryId: cat.id } })).toBe(2);

      // Seule une transaction supprimée logiquement : toujours « utilisée ».
      const { body: onlyDeleted } = await createCategory({ name: 'Ancienne' }).expect(201);
      await addTransaction(onlyDeleted.id, new Date());
      await deleteCategory(onlyDeleted.id).expect(409);

      await deleteCategory(cat.id, cat.id).expect(422);
      await deleteCategory(cat.id, target.id).expect(204);
      const moved = await prisma.transaction.findMany({ where: { id: { in: [live.id, deleted.id] } } });
      expect(moved.map((t) => t.categoryId)).toEqual([target.id, target.id]);
      expect(await prisma.category.findUnique({ where: { id: cat.id } })).toBeNull();
    });

    it('réaffectation vers une catégorie système', async () => {
      const { body: cat } = await createCategory({ name: 'Liquide' }).expect(201);
      const tx = await addTransaction(cat.id);
      await deleteCategory(cat.id, system.cash).expect(204);
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(system.cash);
    });

    it('catégorie avec sous-catégories ⇒ 409 tant qu’elles existent', async () => {
      const { body: root } = await createCategory({ name: 'Parent' }).expect(201);
      const { body: child } = await createCategory({ name: 'Enfant', parentId: root.id }).expect(201);
      await deleteCategory(root.id).expect(409);
      await deleteCategory(child.id).expect(204);
      await deleteCategory(root.id).expect(204);
    });

    it('identifiant inconnu ⇒ 404, non UUID ⇒ 400, sans session ⇒ 401', async () => {
      await patchCategory('00000000-0000-4000-8000-000000000000', { name: 'X' }).expect(404);
      await deleteCategory('pas-un-uuid').expect(400);
      await a.call('delete', `/api/v1/categories/${system.cash}?reassignTo=abc`).expect(400);
      await request(app.getHttpServer()).get('/api/v1/categories').expect(401);
    });
  });

  describe('tags', () => {
    const createTag = (name: unknown) => a.call('post', '/api/v1/tags').send({ name });
    const listTags = async () => (await a.call('get', '/api/v1/tags').expect(200)).body as { id: string; name: string }[];

    it('crée, liste triée, renomme, supprime', async () => {
      const { body: zeta } = await createTag(' zeta ').expect(201);
      const { body: alpha } = await createTag('alpha').expect(201);
      expect(zeta).toEqual({ id: expect.any(String), name: 'zeta' });
      const names = (await listTags()).map((t) => t.name);
      expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('zeta'));

      expect((await a.call('patch', `/api/v1/tags/${alpha.id}`).send({ name: 'beta' }).expect(200)).body).toEqual({ id: alpha.id, name: 'beta' });
      await a.call('delete', `/api/v1/tags/${alpha.id}`).expect(204);
      expect((await listTags()).map((t) => t.id)).not.toContain(alpha.id);
      await a.call('delete', `/api/v1/tags/${alpha.id}`).expect(404);
      await a.call('patch', `/api/v1/tags/${alpha.id}`).send({ name: 'gamma' }).expect(404);
    });

    it('nom unique par utilisateur, sans tenir compte de la casse ⇒ 409', async () => {
      await createTag('Courses').expect(201);
      await createTag('  courses ').expect(409);
      const { body: other } = await createTag('Travail').expect(201);
      await a.call('patch', `/api/v1/tags/${other.id}`).send({ name: 'COURSES' }).expect(409);
      await a.call('patch', `/api/v1/tags/${other.id}`).send({ name: 'TRAVAIL' }).expect(200); // sa propre casse
    });

    it('supprimer un tag le retire des transactions, sans toucher aux transactions', async () => {
      const { body: tag } = await createTag('éphémère').expect(201);
      const tx = await addTransaction(system.groceries);
      await prisma.transactionTag.create({ data: { transactionId: tx.id, tagId: tag.id } });
      await a.call('delete', `/api/v1/tags/${tag.id}`).expect(204);
      expect(await prisma.transactionTag.count({ where: { transactionId: tx.id } })).toBe(0);
      expect(await prisma.transaction.findUnique({ where: { id: tx.id } })).not.toBeNull();
    });

    it.each([
      ['nom vide', { name: ' ' }],
      ['nom trop long', { name: 'x'.repeat(51) }],
      ['nom non textuel', { name: 42 }],
      ['champ inconnu', { name: 'ok', color: '#000000' }],
    ])('refusé (400) : %s', async (_, body) => {
      await a.call('post', '/api/v1/tags').send(body).expect(400);
    });

    it('sans session ⇒ 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/tags').expect(401);
    });
  });
});
