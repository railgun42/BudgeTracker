import { TwoUsers } from './two-users';

// Registre d'isolation (PLAN E7). Chaque route de l'API figure ici, une seule fois :
// - dans publicRoutes si elle est accessible sans session ;
// - sinon dans isolationRegistry avec son test d'isolation entre deux utilisateurs.
// Clé : 'MÉTHODE /api/chemin/:param', telle que déclarée dans le contrôleur.
// test/e2e/isolation-meta.e2e-spec.ts échoue sur une route absente, une entrée orpheline,
// une route publique protégée par JwtAuthGuard ou une route du registre qui ne l'est pas,
// puis exécute chaque test d'isolation.
// Forme attendue pour une ressource : B la crée ; A la lit/modifie/supprime ⇒ 404 ; elle reste intacte pour B.

export type IsolationCheck = (users: TwoUsers) => Promise<unknown>;

export const publicRoutes = [
  'GET /api/health',
  'POST /api/v1/auth/signup',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/forgot',
  'POST /api/v1/auth/reset',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/google',
  'GET /api/v1/auth/google/callback',
];

// Compte créé par B ; vérifie ensuite qu'il est resté intact pour B.
const accountOfB = async ({ b }: TwoUsers) => {
  const { body } = await b.call('post', '/api/v1/accounts').send({ name: 'Compte de B', trackingType: 'NORMAL' }).expect(201);
  return {
    id: body.id as string,
    intact: async () => expect((await b.call('get', `/api/v1/accounts/${body.id}`).expect(200)).body).toEqual(body),
  };
};

// Catégorie perso créée par B ; intacte = toujours listée telle quelle pour B.
const categoryOfB = async ({ b }: TwoUsers) => {
  const { body } = await b.call('post', '/api/v1/categories').send({ name: 'Catégorie de B', color: '#123456' }).expect(201);
  return {
    id: body.id as string,
    intact: async () => expect((await b.call('get', '/api/v1/categories').expect(200)).body).toContainEqual(body),
  };
};

const tagOfB = async ({ b }: TwoUsers) => {
  const { body } = await b.call('post', '/api/v1/tags').send({ name: `tag-b-${Math.random()}` }).expect(201);
  return {
    id: body.id as string,
    name: body.name as string,
    intact: async () => expect((await b.call('get', '/api/v1/tags').expect(200)).body).toContainEqual(body),
  };
};

export const isolationRegistry: Record<string, IsolationCheck> = {
  'GET /api/v1/me': async ({ a, b }) => {
    const [resA, resB] = await Promise.all([a.call('get', '/api/v1/me').expect(200), b.call('get', '/api/v1/me').expect(200)]);
    expect(resA.body.id).toBe(a.id);
    expect(resB.body.id).toBe(b.id);
  },

  'GET /api/v1/accounts': async (users) => {
    const { id } = await accountOfB(users);
    const { body } = await users.a.call('get', '/api/v1/accounts').expect(200);
    expect(body.map((acc: { id: string }) => acc.id)).not.toContain(id);
  },
  'POST /api/v1/accounts': async (users) => {
    const { body } = await users.a.call('post', '/api/v1/accounts').send({ name: 'Compte de A', trackingType: 'NORMAL' }).expect(201);
    await users.b.call('get', `/api/v1/accounts/${body.id}`).expect(404);
  },
  'GET /api/v1/accounts/:id': async (users) => {
    const { id, intact } = await accountOfB(users);
    await users.a.call('get', `/api/v1/accounts/${id}`).expect(404);
    await intact();
  },
  'PATCH /api/v1/accounts/:id': async (users) => {
    const { id, intact } = await accountOfB(users);
    await users.a.call('patch', `/api/v1/accounts/${id}`).send({ version: 1, name: 'Piraté' }).expect(404);
    await intact();
  },
  'DELETE /api/v1/accounts/:id': async (users) => {
    const { id, intact } = await accountOfB(users);
    await users.a.call('delete', `/api/v1/accounts/${id}`).expect(404);
    await intact();
  },
  'POST /api/v1/accounts/:id/restore': async (users) => {
    const { id } = await accountOfB(users);
    await users.b.call('delete', `/api/v1/accounts/${id}`).expect(204);
    await users.a.call('post', `/api/v1/accounts/${id}/restore`).expect(404);
    await users.b.call('get', `/api/v1/accounts/${id}`).expect(404); // toujours supprimé pour B
  },

  'GET /api/v1/categories': async (users) => {
    const { id } = await categoryOfB(users);
    const { body } = await users.a.call('get', '/api/v1/categories').expect(200);
    expect(body.map((c: { id: string }) => c.id)).not.toContain(id);
  },
  'POST /api/v1/categories': async (users) => {
    const { id, intact } = await categoryOfB(users);
    await users.a.call('post', '/api/v1/categories').send({ name: 'Sous B', parentId: id }).expect(404);
    await intact();
    const { body } = await users.a.call('post', '/api/v1/categories').send({ name: 'Catégorie de A' }).expect(201);
    expect((await users.b.call('get', '/api/v1/categories').expect(200)).body.map((c: { id: string }) => c.id)).not.toContain(body.id);
  },
  'PATCH /api/v1/categories/:id': async (users) => {
    const { id, intact } = await categoryOfB(users);
    await users.a.call('patch', `/api/v1/categories/${id}`).send({ name: 'Piraté' }).expect(404);
    const { body: own } = await users.a.call('post', '/api/v1/categories').send({ name: 'À A' }).expect(201);
    await users.a.call('patch', `/api/v1/categories/${own.id}`).send({ parentId: id }).expect(404); // parent de B inutilisable
    await intact();
  },
  'DELETE /api/v1/categories/:id': async (users) => {
    const { id, intact } = await categoryOfB(users);
    await users.a.call('delete', `/api/v1/categories/${id}`).expect(404);
    const { body: own } = await users.a.call('post', '/api/v1/categories').send({ name: 'À A' }).expect(201);
    await users.a.call('delete', `/api/v1/categories/${own.id}?reassignTo=${id}`).expect(404); // cible de B inutilisable
    expect((await users.a.call('get', '/api/v1/categories').expect(200)).body).toContainEqual(own);
    await intact();
  },

  'GET /api/v1/tags': async (users) => {
    const { id } = await tagOfB(users);
    const { body } = await users.a.call('get', '/api/v1/tags').expect(200);
    expect(body.map((t: { id: string }) => t.id)).not.toContain(id);
  },
  'POST /api/v1/tags': async (users) => {
    const { name, intact } = await tagOfB(users);
    const { body } = await users.a.call('post', '/api/v1/tags').send({ name }).expect(201); // même nom que B : pas de conflit
    expect((await users.b.call('get', '/api/v1/tags').expect(200)).body.map((t: { id: string }) => t.id)).not.toContain(body.id);
    await intact();
  },
  'PATCH /api/v1/tags/:id': async (users) => {
    const { id, intact } = await tagOfB(users);
    await users.a.call('patch', `/api/v1/tags/${id}`).send({ name: 'Piraté' }).expect(404);
    await intact();
  },
  'DELETE /api/v1/tags/:id': async (users) => {
    const { id, intact } = await tagOfB(users);
    await users.a.call('delete', `/api/v1/tags/${id}`).expect(404);
    await intact();
  },
};
