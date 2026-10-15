import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CategoryDto, CategorySuggestionDto, NotificationsDto } from '@budgetracker/shared';
import { grantAdmin } from '../../scripts/grant-admin';
import { seed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTwoUsers, TestUser, TwoUsers } from '../helpers/two-users';

// E41 — suggestion de catégorie et réponse à l'auteur (SPEC §13.5). A est admin, B l'auteur des suggestions.
// La liste admin est globale (autres suites en parallèle) : les assertions portent sur les suggestions créées ici.
describe('Suggestions de catégorie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: TwoUsers;
  let a: TestUser;
  let b: TestUser;
  let sportId: string;
  const names: string[] = [];
  const unique = (name: string) => {
    names.push(`${name} ${Math.random().toString(36).slice(2, 8)}`);
    return names.at(-1)!;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await seed(prisma);
    sportId = (await prisma.category.findUniqueOrThrow({ where: { nameKey: 'sport' } })).id;
  });

  beforeEach(async () => {
    users = await createTwoUsers(app);
    ({ a, b } = users);
    await grantAdmin(prisma, (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).email);
  });

  // Journal de l'admin A retiré à part (sinon il resterait sans auteur) ; suggestions et notifications partent
  // avec les utilisateurs ; puis les globales créées par une acceptation.
  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminId: a.id }, { targetId: a.id }] } });
    await users.cleanup();
    await prisma.category.deleteMany({ where: { userId: null, name: { in: names.splice(0) } } });
  });

  afterAll(() => app.close());

  const suggest = (user: TestUser, body: object) => user.call('post', '/api/v1/categories').send(body);
  const mine = async (user: TestUser) => (await user.call('get', '/api/v1/categories/suggestions').expect(200)).body as CategorySuggestionDto[];
  const inbox = async (query = '') => (await a.call('get', `/api/v1/admin/category-suggestions${query}`).expect(200)).body as CategorySuggestionDto[];
  const resolve = (id: string, body: object) => a.call('post', `/api/v1/admin/category-suggestions/${id}/resolve`).send(body);
  const categories = async (user: TestUser) => (await user.call('get', '/api/v1/categories').expect(200)).body as CategoryDto[];
  const notifications = async (user: TestUser) => (await user.call('get', '/api/v1/notifications').expect(200)).body as NotificationsDto;
  const globalsNamed = (name: string) => prisma.category.findMany({ where: { userId: null, name } });

  it('case cochée ⇒ catégorie perso et suggestion ; décochée ou absente ⇒ aucune suggestion', async () => {
    const name = unique('Aide sociale');
    const { body: category } = await suggest(b, { name, suggest: true }).expect(201);
    expect(category).toMatchObject({ name, system: false, parentId: null });
    expect(await mine(b)).toEqual([{ id: expect.any(String), name, parentId: null, status: 'PENDING', createdAt: expect.stringMatching(/Z$/), treatedAt: null }]);

    await suggest(b, { name: unique('Sans suggestion'), suggest: false }).expect(201);
    await suggest(b, { name: unique('Sans case') }).expect(201);
    expect(await mine(b)).toHaveLength(1);

    // Sous une catégorie globale : la suggestion garde le parent.
    const sub = unique('Escalade');
    await suggest(b, { name: sub, parentId: sportId, suggest: true }).expect(201);
    expect((await mine(b))[0]).toMatchObject({ name: sub, parentId: sportId });
  });

  it('sous une catégorie perso ⇒ 422 et rien de créé ; suggest non booléen ⇒ 400 ; refusé par /admin/categories', async () => {
    const { body: own } = await suggest(b, { name: unique('Perso') }).expect(201);
    const name = unique('Sous perso');
    await suggest(b, { name, parentId: own.id, suggest: true }).expect(422);
    await suggest(b, { name, suggest: 'oui' }).expect(400);
    expect((await categories(b)).map((c) => c.name)).not.toContain(name);
    expect(await mine(b)).toEqual([]);
    await a.call('post', '/api/v1/admin/categories').send({ name, suggest: true }).expect(400);
  });

  it('chacun ne voit que ses propres suggestions ; la liste admin n’expose ni auteur ni e-mail', async () => {
    const name = unique('Animaux');
    await suggest(b, { name, suggest: true }).expect(201);
    expect(await mine(a)).toEqual([]);
    const [mineB] = await mine(b);
    const row = (await inbox()).find((s) => s.id === mineB.id);
    expect(row).toEqual(mineB);
    expect(JSON.stringify(await inbox())).not.toMatch(/@|userId/);
  });

  it('acceptation : la catégorie de l’auteur devient la globale (sans doublon, transactions gardées) ; l’auteur reçoit la réponse ; journalisé ; non rejouable', async () => {
    const name = unique('Escalade');
    const { body: own } = await suggest(b, { name, parentId: sportId, suggest: true, color: '#123456' }).expect(201);
    const account = (await b.call('post', '/api/v1/accounts').send({ name: 'Courant', trackingType: 'NORMAL' }).expect(201)).body;
    const tx = (await b.call('post', '/api/v1/transactions').send({ accountId: account.id, categoryId: sportId, subcategoryId: own.id, amountCents: 1500, date: '2026-10-01', name: 'Bloc' }).expect(201)).body;
    const [{ id }] = await mine(b);
    const reply = `J'ai vu ta suggestion de la catégorie ${name}, je l'ai ajoutée, merci !`;

    const { body } = await resolve(id, { decision: 'ACCEPTED', reply: `  ${reply} ` }).expect(200);
    expect(body).toMatchObject({ id, status: 'ACCEPTED', treatedAt: expect.stringMatching(/Z$/) });
    // Même catégorie, devenue globale : une seule chez l'auteur, visible pour lui, couleur et transaction conservées.
    expect(await globalsNamed(name)).toEqual([expect.objectContaining({ id: own.id, parentId: sportId, color: '#123456', archivedAt: null })]);
    const ofB = (await categories(b)).filter((c) => c.name === name);
    expect(ofB).toEqual([expect.objectContaining({ id: own.id, system: true, hidden: false, customName: null })]);
    expect((await b.call('get', `/api/v1/transactions/${tx.id}`).expect(200)).body.categoryId).toBe(own.id);
    await b.call('patch', `/api/v1/categories/${own.id}`).send({ name: 'Plus à moi' }).expect(403);

    const { items } = await notifications(b);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'PERSONAL', message: reply, read: false }));
    expect((await notifications(a)).items.map((n) => n.message)).not.toContain(reply);
    expect((await mine(b))[0]).toMatchObject({ status: 'ACCEPTED' });

    const actions = (await prisma.adminAuditLog.findMany({ where: { adminId: a.id } })).map((l) => l.action).sort();
    expect(actions).toEqual(['CATEGORY_CREATED', 'CATEGORY_SUGGESTION_ACCEPTED', 'NOTIFICATION_SENT']);

    // Rejouée (quelle que soit la décision) ⇒ 409, rien de plus.
    for (const decision of ['ACCEPTED', 'REJECTED', 'TREATED']) await resolve(id, { decision, reply: 'Encore' }).expect(409);
    expect(await globalsNamed(name)).toHaveLength(1);
    expect((await notifications(b)).items).toHaveLength(items.length);
  });

  it('autres utilisateurs : masquée par défaut s’ils étaient déjà inscrits (démasquable), visible pour les nouveaux inscrits', async () => {
    const name = unique('Bénévolat');
    const { body: own } = await suggest(b, { name, suggest: true }).expect(201);
    const [{ id }] = await mine(b);
    await resolve(id, { decision: 'ACCEPTED' }).expect(200);

    const ofA = () => categories(a).then((list) => list.find((c) => c.id === own.id));
    expect(await ofA()).toMatchObject({ name, system: true, hidden: true });
    // Aucune ligne écrite pour les autres utilisateurs : seul l'auteur a une préférence.
    expect(await prisma.userCategoryPreference.findMany({ where: { categoryId: own.id }, select: { userId: true, hidden: true } })).toEqual([{ userId: b.id, hidden: false }]);

    expect((await a.call('put', `/api/v1/categories/${own.id}/preference`).send({ hidden: false }).expect(200)).body).toMatchObject({ hidden: false });
    expect(await ofA()).toMatchObject({ hidden: false });
    expect((await a.call('put', `/api/v1/categories/${own.id}/preference`).send({ hidden: true }).expect(200)).body).toMatchObject({ hidden: true });
    expect(await prisma.userCategoryPreference.count({ where: { categoryId: own.id, userId: a.id } })).toBe(0); // retour au défaut

    const later = await createTwoUsers(app);
    try {
      expect((await categories(later.a)).find((c) => c.id === own.id)).toMatchObject({ hidden: false });
    } finally {
      await later.cleanup();
    }
  });

  it('auteur renommé ou ayant supprimé sa catégorie depuis : nom gardé pour lui seul, ou globale neuve', async () => {
    const [renamed, deleted] = [unique('Avant'), unique('Supprimée')];
    const { body: own } = await suggest(b, { name: renamed, suggest: true }).expect(201);
    await b.call('patch', `/api/v1/categories/${own.id}`).send({ name: 'Mon nom à moi' }).expect(200);
    const { body: gone } = await suggest(b, { name: deleted, suggest: true }).expect(201);
    await b.call('delete', `/api/v1/categories/${gone.id}`).expect(204);
    const byName = Object.fromEntries((await mine(b)).map((s) => [s.name, s.id]));

    await resolve(byName[renamed], { decision: 'ACCEPTED' }).expect(200);
    expect((await categories(b)).find((c) => c.id === own.id)).toMatchObject({ system: true, name: renamed, customName: 'Mon nom à moi', hidden: false });
    expect((await categories(a)).find((c) => c.id === own.id)).toMatchObject({ name: renamed, customName: null, hidden: true });

    await resolve(byName[deleted], { decision: 'ACCEPTED' }).expect(200);
    const [fresh] = await globalsNamed(deleted);
    expect(fresh.id).not.toBe(gone.id);
    expect((await categories(b)).filter((c) => c.name === deleted)).toEqual([expect.objectContaining({ id: fresh.id, hidden: false })]);
    expect((await categories(a)).find((c) => c.id === fresh.id)).toMatchObject({ hidden: true });
  });

  it('refus ⇒ aucune globale ; sans réponse ⇒ aucune notification ; traiter ⇒ statut seul', async () => {
    const [refused, treated] = [unique('Refusée'), unique('Traitée')];
    await suggest(b, { name: refused, suggest: true }).expect(201);
    await suggest(b, { name: treated, suggest: true }).expect(201);
    const byName = Object.fromEntries((await mine(b)).map((s) => [s.name, s.id]));

    await resolve(byName[refused], { decision: 'REJECTED' }).expect(200);
    await resolve(byName[treated], { decision: 'TREATED' }).expect(200);
    expect(await globalsNamed(refused)).toEqual([]);
    expect(await globalsNamed(treated)).toEqual([]);
    expect((await notifications(b)).items.filter((n) => n.kind === 'PERSONAL')).toEqual([]);
    expect(Object.fromEntries((await mine(b)).map((s) => [s.name, s.status]))).toEqual({ [refused]: 'REJECTED', [treated]: 'TREATED' });

    const ours = (list: CategorySuggestionDto[]) => list.filter((s) => s.name === refused || s.name === treated).map((s) => s.status);
    expect(ours(await inbox('?status=REJECTED'))).toEqual(['REJECTED']);
    expect(ours(await inbox('?status=PENDING'))).toEqual([]);
  });

  it('globale déjà existante ⇒ 409 et la suggestion reste en attente (l’admin peut la traiter)', async () => {
    const name = unique('Doublon');
    await suggest(a, { name, suggest: true }).expect(201);
    await suggest(b, { name, suggest: true }).expect(201);
    const [first] = await mine(a);
    const [second] = await mine(b);
    await resolve(first.id, { decision: 'ACCEPTED' }).expect(200);
    await resolve(second.id, { decision: 'ACCEPTED', reply: 'Merci' }).expect(409);
    expect((await mine(b))[0]).toMatchObject({ status: 'PENDING', treatedAt: null });
    expect((await notifications(b)).items.filter((n) => n.kind === 'PERSONAL')).toEqual([]);
    await resolve(second.id, { decision: 'TREATED', reply: 'Déjà ajoutée, merci !' }).expect(200);
    expect((await notifications(b)).items).toContainEqual(expect.objectContaining({ message: 'Déjà ajoutée, merci !' }));
  });

  it('acceptations simultanées : une seule globale, une seule réussite', async () => {
    const name = unique('Concurrence');
    await suggest(b, { name, suggest: true }).expect(201);
    const [{ id }] = await mine(b);
    const results = await Promise.all(Array.from({ length: 5 }, () => resolve(id, { decision: 'ACCEPTED' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await globalsNamed(name)).toHaveLength(1);
  });

  it('entrées invalides ⇒ 400, inconnue ⇒ 404, non admin ⇒ 403 et rien de modifié', async () => {
    await suggest(b, { name: unique('Validation'), suggest: true }).expect(201);
    const [s] = await mine(b);
    for (const bad of [{}, { decision: 'PENDING' }, { decision: 'ACCEPTED', reply: '   ' }, { decision: 'ACCEPTED', reply: 'x'.repeat(2001) }, { decision: 'ACCEPTED', name: 'Autre' }])
      await resolve(s.id, bad).expect(400);
    await a.call('get', '/api/v1/admin/category-suggestions?status=DONE').expect(400);
    await resolve('00000000-0000-4000-8000-000000000000', { decision: 'TREATED' }).expect(404);
    await b.call('get', '/api/v1/admin/category-suggestions').expect(403);
    await b.call('post', `/api/v1/admin/category-suggestions/${s.id}/resolve`).send({ decision: 'ACCEPTED' }).expect(403);
    expect(await mine(b)).toEqual([s]);
  });

  it('20 suggestions en attente au plus : la 21ᵉ ⇒ 429 sans créer la catégorie', async () => {
    await prisma.categorySuggestion.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ userId: b.id, name: `Ancienne ${i}` })) });
    const name = unique('Une de trop');
    await suggest(b, { name, suggest: true }).expect(429);
    expect((await categories(b)).map((c) => c.name)).not.toContain(name);
    await suggest(b, { name }).expect(201);
  });

  it('retrait par l’auteur : en attente ⇒ annulée (catégorie perso gardée, absente de la boîte admin) ; traitée ⇒ « vu »', async () => {
    const name = unique('Annulée');
    const { body: category } = await suggest(b, { name, suggest: true }).expect(201);
    const [pending] = await mine(b);
    await b.call('delete', `/api/v1/categories/suggestions/${pending.id}`).expect(204);
    expect(await mine(b)).toEqual([]);
    expect((await inbox()).map((s) => s.id)).not.toContain(pending.id);
    expect(await categories(b)).toContainEqual(category);
    await resolve(pending.id, { decision: 'ACCEPTED' }).expect(404); // plus rien à décider
    await b.call('delete', `/api/v1/categories/suggestions/${pending.id}`).expect(404);

    await suggest(b, { name: unique('Refusée'), suggest: true }).expect(201);
    const [s] = await mine(b);
    await resolve(s.id, { decision: 'REJECTED' }).expect(200);
    await b.call('delete', `/api/v1/categories/suggestions/${s.id}`).expect(204);
    expect(await mine(b)).toEqual([]);
  });

  it('suppression du compte : ses suggestions partent avec lui', async () => {
    await suggest(b, { name: unique('Partie'), suggest: true }).expect(201);
    await b.call('delete', '/api/v1/me').expect(204);
    expect(await prisma.categorySuggestion.count({ where: { userId: b.id } })).toBe(0);
  });
});
