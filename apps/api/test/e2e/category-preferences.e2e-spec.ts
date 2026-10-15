import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CategoryDto } from '@budgetracker/shared';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E36 — catégories personnalisables : masquage et renommage d'une catégorie globale pour soi seul (SPEC §3.2, §13.4).
describe('Préférences de catégories (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let b: TestUser;
  let accountId: string;
  const sys: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    for (const key of ['sport', 'sport.license', 'housing', 'health'])
      sys[key] = (await prisma.category.findUniqueOrThrow({ where: { nameKey: key } })).id;
    users = await createTwoUsers(app);
    ({ a, b } = users);
    accountId = (await a.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  const setPref = (user: TestUser, id: string, body: object) => user.call('put', `/api/v1/categories/${id}/preference`).send(body);
  const find = async (user: TestUser, id: string) =>
    ((await user.call('get', '/api/v1/categories').expect(200)).body as CategoryDto[]).find((c) => c.id === id);

  it('A masque une catégorie globale : toujours visible pour B, toujours sur les transactions et dans les stats de A', async () => {
    const { body: tx } = await a
      .call('post', '/api/v1/transactions')
      .send({ accountId, categoryId: sys.sport, subcategoryId: sys['sport.license'], amountCents: 4200, date: '2026-05-01' })
      .expect(201);

    const { body: hidden } = await setPref(a, sys.sport, { hidden: true }).expect(200);
    expect(hidden).toMatchObject({ id: sys.sport, system: true, nameKey: 'sport', hidden: true, customName: null });
    expect(await find(a, sys.sport)).toEqual(hidden); // masquée mais toujours listée (noms de l'historique et des stats)
    expect(await find(b, sys.sport)).toMatchObject({ hidden: false, customName: null });

    expect((await a.call('get', `/api/v1/transactions/${tx.id}`).expect(200)).body).toEqual(tx);
    const { body: stats } = await a.call('get', '/api/v1/stats/by-category?from=2026-05-01&to=2026-05-31').expect(200);
    expect(stats).toContainEqual({ categoryId: sys['sport.license'], incomeCents: 0, expenseCents: 4200 });

    // Ne bloque pas la saisie côté API (seules les listes du front l'excluent).
    await a.call('post', '/api/v1/transactions').send({ accountId, categoryId: sys.sport, amountCents: 100, date: '2026-05-02' }).expect(201);

    // Démasquer avec le nom d'origine supprime la préférence.
    expect((await setPref(a, sys.sport, { hidden: false }).expect(200)).body).toMatchObject({ hidden: false, customName: null });
    expect(await prisma.userCategoryPreference.count({ where: { userId: a.id, categoryId: sys.sport } })).toBe(0);
  });

  it('A renomme une catégorie globale pour lui seul ; B voit le nom d’origine ; la globale est inchangée', async () => {
    const before = await prisma.category.findUniqueOrThrow({ where: { id: sys.housing } });
    expect((await setPref(a, sys.housing, { hidden: false, customName: '  Maison  ' }).expect(200)).body).toMatchObject({ customName: 'Maison', hidden: false });
    expect(await find(a, sys.housing)).toMatchObject({ customName: 'Maison', nameKey: 'housing' });
    expect(await find(b, sys.housing)).toMatchObject({ customName: null, hidden: false });
    expect(await prisma.category.findUniqueOrThrow({ where: { id: sys.housing } })).toEqual(before);

    // Remplacement complet : masquer en gardant le nom, puis revenir au nom d'origine.
    expect((await setPref(a, sys.housing, { hidden: true, customName: 'Maison' }).expect(200)).body).toMatchObject({ hidden: true, customName: 'Maison' });
    expect((await setPref(a, sys.housing, { hidden: true, customName: null }).expect(200)).body).toMatchObject({ hidden: true, customName: null });
  });

  it('sous-catégorie perso sous une catégorie globale ; 3ᵉ niveau refusé', async () => {
    const { body: child } = await a.call('post', '/api/v1/categories').send({ name: 'Vélo', parentId: sys.sport }).expect(201);
    expect(child).toMatchObject({ parentId: sys.sport, system: false, hidden: false, customName: null });
    await a.call('post', '/api/v1/categories').send({ name: 'Trop profond', parentId: child.id }).expect(422);
    await a.call('post', '/api/v1/categories').send({ name: 'Trop profond', parentId: sys['sport.license'] }).expect(422);
    expect((await find(b, child.id))).toBeUndefined();
  });

  it('catégorie de B inutilisable par A (transaction, parent, préférence)', async () => {
    const { body: ofB } = await b.call('post', '/api/v1/categories').send({ name: 'Secret de B' }).expect(201);
    await a.call('post', '/api/v1/transactions').send({ accountId, categoryId: ofB.id, amountCents: 100, date: '2026-05-01' }).expect(404);
    await a.call('post', '/api/v1/categories').send({ name: 'Sous B', parentId: ofB.id }).expect(404);
    await setPref(a, ofB.id, { hidden: true }).expect(404);
  });

  it('préférence sur sa propre catégorie ⇒ 422 ; entrées invalides ⇒ 400 ; inconnue ⇒ 404', async () => {
    const { body: own } = await a.call('post', '/api/v1/categories').send({ name: 'À moi' }).expect(201);
    await setPref(a, own.id, { hidden: true }).expect(422);
    for (const body of [{}, { hidden: 'oui' }, { hidden: true, customName: '   ' }, { hidden: true, customName: 'x'.repeat(101) }, { hidden: true, userId: b.id }])
      await setPref(a, sys.health, body).expect(400);
    await setPref(a, '00000000-0000-4000-8000-000000000000', { hidden: true }).expect(404);
    await setPref(a, 'abc', { hidden: true }).expect(400);
    expect(await prisma.userCategoryPreference.count({ where: { categoryId: sys.health } })).toBe(0);
  });
});
