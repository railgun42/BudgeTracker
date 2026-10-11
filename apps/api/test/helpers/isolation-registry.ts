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
};
