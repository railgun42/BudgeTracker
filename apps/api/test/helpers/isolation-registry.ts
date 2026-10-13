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

// Transaction créée par B sur son compte, avec un tag ; intacte = relue telle quelle par B.
const transactionOfB = async (users: TwoUsers) => {
  const { b } = users;
  const account = await accountOfB(users);
  const tag = await tagOfB(users);
  const { body: category } = await b.call('get', '/api/v1/categories').expect(200);
  const { body } = await b
    .call('post', '/api/v1/transactions')
    .send({ accountId: account.id, categoryId: category[0].id, amountCents: 1234, date: '2026-03-01', tagIds: [tag.id] })
    .expect(201);
  return {
    id: body.id as string,
    accountId: account.id,
    tagId: tag.id,
    intact: async () => expect((await b.call('get', `/api/v1/transactions/${body.id}`).expect(200)).body).toEqual(body),
  };
};

// Virement entre deux comptes de B ; intact = relu tel quel par B.
const transferOfB = async (users: TwoUsers) => {
  const [from, to] = [await accountOfB(users), await accountOfB(users)];
  const { body } = await users.b.call('post', '/api/v1/transfers').send({ fromAccountId: from.id, toAccountId: to.id, amountCents: 500, date: '2026-03-01' }).expect(201);
  return {
    id: body.id as string,
    fromAccountId: from.id,
    intact: async () => expect((await users.b.call('get', `/api/v1/transfers/${body.id}`).expect(200)).body).toEqual(body),
  };
};

// Compte de A, pour les tentatives de référence croisée vers les données de B.
const accountOfA = async ({ a }: TwoUsers) =>
  (await a.call('post', '/api/v1/accounts').send({ name: 'Compte de A', trackingType: 'NORMAL' }).expect(201)).body.id as string;
const systemCategory = async ({ a }: TwoUsers) =>
  ((await a.call('get', '/api/v1/categories').expect(200)).body as { id: string; system: boolean }[]).find((c) => c.system)!.id;

// Récurrence de B (rien de dû : démarre en 2030) ; intacte = relue telle quelle par B.
const recurrenceOfB = async (users: TwoUsers) => {
  const account = await accountOfB(users);
  const tag = await tagOfB(users);
  const categoryId = await systemCategory(users);
  const { body } = await users.b
    .call('post', '/api/v1/recurrences')
    .send({ accountId: account.id, interval: 1, unit: 'MONTH', startDate: '2030-01-31', template: { categoryId, amountCents: 900, tagIds: [tag.id] } })
    .expect(201);
  return {
    id: body.id as string,
    accountId: account.id,
    tagId: tag.id,
    intact: async () => expect((await users.b.call('get', `/api/v1/recurrences/${body.id}`).expect(200)).body).toEqual(body),
  };
};

// Compte à intérêts de B avec un taux ; intact = taux relus tels quels par B.
const interestAccountOfB = async ({ b }: TwoUsers) => {
  const { body: account } = await b.call('post', '/api/v1/accounts').send({ name: 'Livret de B', trackingType: 'WITH_INTEREST' }).expect(201);
  await b.call('post', `/api/v1/accounts/${account.id}/interest-rates`).send({ rateBp: 300, effectiveDate: '2026-01-01' }).expect(201);
  const { body: rates } = await b.call('get', `/api/v1/accounts/${account.id}/interest-rates`).expect(200);
  return {
    id: account.id as string,
    intact: async () => expect((await b.call('get', `/api/v1/accounts/${account.id}/interest-rates`).expect(200)).body).toEqual(rates),
  };
};

// Transaction de B avec une pièce jointe ; intacte = transaction (pièce comprise) et URL toujours lisibles par B.
const PDF = Buffer.from('%PDF-1.4 %%EOF', 'latin1');
const attachmentOfB = async (users: TwoUsers) => {
  const { b } = users;
  const { id } = await transactionOfB(users);
  await b.call('post', `/api/v1/transactions/${id}/attachment`).attach('file', PDF, 'b.pdf').expect(201);
  const { body } = await b.call('get', `/api/v1/transactions/${id}`).expect(200);
  return {
    id,
    intact: async () => {
      expect((await b.call('get', `/api/v1/transactions/${id}`).expect(200)).body).toEqual(body);
      await b.call('get', `/api/v1/transactions/${id}/attachment`).expect(200);
    },
  };
};

// Stats : une transaction de B ne change rien aux agrégats de A ; le compte de B en filtre ⇒ 404.
const statsOfB =
  (path: string): IsolationCheck =>
  async (users) => {
    const before = (await users.a.call('get', path).expect(200)).body;
    const { accountId } = await transactionOfB(users); // avec un tag : visible aussi dans by-tag
    expect((await users.a.call('get', path).expect(200)).body).toEqual(before);
    await users.a.call('get', `${path}?accountId=${accountId}`).expect(404);
    expect((await users.b.call('get', `${path}?accountId=${accountId}`).expect(200)).body).toHaveLength(1);
  };

// Calculateurs : aucune donnée utilisateur ; A et B obtiennent le même résultat pour les mêmes paramètres.
const sameForBoth =
  (path: string): IsolationCheck =>
  async ({ a, b }) =>
    expect((await a.call('get', path).expect(200)).body).toEqual((await b.call('get', path).expect(200)).body);

// Scénario de B ; intact = relu tel quel par B.
const scenarioOfB = async ({ b }: TwoUsers) => {
  const { body } = await b.call('post', '/api/v1/scenarios').send({ name: 'Scénario de B', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 999 }] } }).expect(201);
  return {
    id: body.id as string,
    intact: async () => expect((await b.call('get', `/api/v1/scenarios/${body.id}`).expect(200)).body).toEqual(body),
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

  'GET /api/v1/accounts/:id/balance': async (users) => {
    const { accountId } = await transactionOfB(users);
    await users.a.call('get', `/api/v1/accounts/${accountId}/balance`).expect(404);
    expect((await users.b.call('get', `/api/v1/accounts/${accountId}/balance`).expect(200)).body).toEqual({ currentCents: -1234, forecastCents: -1234 });
  },

  'GET /api/v1/accounts/:id/interest-rates': async (users) => {
    const { id, intact } = await interestAccountOfB(users);
    await users.a.call('get', `/api/v1/accounts/${id}/interest-rates`).expect(404);
    await intact();
  },
  'POST /api/v1/accounts/:id/interest-rates': async (users) => {
    const { id, intact } = await interestAccountOfB(users);
    await users.a.call('post', `/api/v1/accounts/${id}/interest-rates`).send({ rateBp: 9_999, effectiveDate: '2026-01-01' }).expect(404);
    await intact();
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
  'GET /api/v1/transactions': async (users) => {
    const { id, accountId, tagId } = await transactionOfB(users);
    const { body } = await users.a.call('get', '/api/v1/transactions').expect(200);
    expect(body.items.map((t: { id: string }) => t.id)).not.toContain(id);
    await users.a.call('get', `/api/v1/transactions?accountId=${accountId}`).expect(404);
    await users.a.call('get', `/api/v1/transactions?tagId=${tagId}`).expect(404);
    const { id: categoryId } = await categoryOfB(users);
    await users.a.call('get', `/api/v1/transactions?categoryId=${categoryId}`).expect(404);
  },
  'POST /api/v1/transactions': async (users) => {
    const { accountId, tagId, intact } = await transactionOfB(users);
    const { id: categoryOfBId } = await categoryOfB(users);
    const ownAccount = await accountOfA(users);
    const categoryId = await systemCategory(users);
    const send = (body: object) => users.a.call('post', '/api/v1/transactions').send({ accountId: ownAccount, categoryId, amountCents: 100, date: '2026-03-01', ...body });
    await send({ accountId }).expect(404); // compte de B
    await send({ categoryId: categoryOfBId }).expect(404); // catégorie perso de B
    await send({ tagIds: [tagId] }).expect(404); // tag de B
    const { body } = await send({}).expect(201);
    await users.b.call('get', `/api/v1/transactions/${body.id}`).expect(404);
    await intact();
  },
  'GET /api/v1/transactions/:id': async (users) => {
    const { id, intact } = await transactionOfB(users);
    await users.a.call('get', `/api/v1/transactions/${id}`).expect(404);
    await intact();
  },
  'PATCH /api/v1/transactions/:id': async (users) => {
    const { id, accountId, tagId, intact } = await transactionOfB(users);
    await users.a.call('patch', `/api/v1/transactions/${id}`).send({ version: 1, amountCents: 1 }).expect(404);
    // Sa propre transaction, déplacée vers des références de B ⇒ 404.
    const categoryId = await systemCategory(users);
    const ownAccount = await accountOfA(users);
    const { body: own } = await users.a
      .call('post', '/api/v1/transactions')
      .send({ accountId: ownAccount, categoryId, amountCents: 100, date: '2026-03-01' })
      .expect(201);
    await users.a.call('patch', `/api/v1/transactions/${own.id}`).send({ version: 1, accountId }).expect(404);
    await users.a.call('patch', `/api/v1/transactions/${own.id}`).send({ version: 1, tagIds: [tagId] }).expect(404);
    expect((await users.a.call('get', `/api/v1/transactions/${own.id}`).expect(200)).body).toEqual(own);
    await intact();
  },
  'DELETE /api/v1/transactions/:id': async (users) => {
    const { id, intact } = await transactionOfB(users);
    await users.a.call('delete', `/api/v1/transactions/${id}`).expect(404);
    await intact();
  },
  'POST /api/v1/transactions/:id/restore': async (users) => {
    const { id } = await transactionOfB(users);
    await users.b.call('delete', `/api/v1/transactions/${id}`).expect(204);
    await users.a.call('post', `/api/v1/transactions/${id}/restore`).expect(404);
    await users.b.call('get', `/api/v1/transactions/${id}`).expect(404); // toujours supprimée pour B
  },

  'POST /api/v1/transactions/:id/attachment': async (users) => {
    const { id, intact } = await transactionOfB(users);
    await users.a.call('post', `/api/v1/transactions/${id}/attachment`).attach('file', PDF, 'a.pdf').expect(404);
    await intact(); // toujours sans pièce
  },
  'GET /api/v1/transactions/:id/attachment': async (users) => {
    const { id, intact } = await attachmentOfB(users);
    await users.a.call('get', `/api/v1/transactions/${id}/attachment`).expect(404);
    await intact();
  },
  'DELETE /api/v1/transactions/:id/attachment': async (users) => {
    const { id, intact } = await attachmentOfB(users);
    await users.a.call('delete', `/api/v1/transactions/${id}/attachment`).expect(404);
    await intact();
  },

  'POST /api/v1/transfers': async (users) => {
    const { fromAccountId, intact } = await transferOfB(users);
    const ownAccount = await accountOfA(users);
    const send = (body: object) => users.a.call('post', '/api/v1/transfers').send({ amountCents: 100, date: '2026-03-01', ...body });
    await send({ fromAccountId, toAccountId: ownAccount }).expect(404); // débiter B
    await send({ fromAccountId: ownAccount, toAccountId: fromAccountId }).expect(404); // créditer B
    const { body } = await send({ fromAccountId: ownAccount, toAccountId: await accountOfA(users) }).expect(201);
    await users.b.call('get', `/api/v1/transfers/${body.id}`).expect(404);
    await intact();
  },
  'GET /api/v1/transfers/:id': async (users) => {
    const { id, intact } = await transferOfB(users);
    await users.a.call('get', `/api/v1/transfers/${id}`).expect(404);
    await intact();
  },
  'PATCH /api/v1/transfers/:id': async (users) => {
    const { id, intact } = await transferOfB(users);
    await users.a.call('patch', `/api/v1/transfers/${id}`).send({ version: 1, amountCents: 1 }).expect(404);
    await intact();
  },
  'GET /api/v1/recurrences': async (users) => {
    const { id } = await recurrenceOfB(users);
    const { body } = await users.a.call('get', '/api/v1/recurrences').expect(200);
    expect(body.map((r: { id: string }) => r.id)).not.toContain(id);
  },
  'POST /api/v1/recurrences': async (users) => {
    const { accountId, tagId, intact } = await recurrenceOfB(users);
    const { id: categoryOfBId } = await categoryOfB(users);
    const ownAccount = await accountOfA(users);
    const categoryId = await systemCategory(users);
    const send = (body: object, template: object = {}) =>
      users.a.call('post', '/api/v1/recurrences').send({ accountId: ownAccount, interval: 1, unit: 'MONTH', startDate: '2030-01-31', ...body, template: { categoryId, amountCents: 100, ...template } });
    await send({ accountId }).expect(404); // compte de B
    await send({}, { categoryId: categoryOfBId }).expect(404); // catégorie perso de B
    await send({}, { tagIds: [tagId] }).expect(404); // tag de B
    const { body } = await send({}).expect(201);
    await users.b.call('get', `/api/v1/recurrences/${body.id}`).expect(404);
    await intact();
  },
  'GET /api/v1/recurrences/:id': async (users) => {
    const { id, intact } = await recurrenceOfB(users);
    await users.a.call('get', `/api/v1/recurrences/${id}`).expect(404);
    await intact();
  },
  'PATCH /api/v1/recurrences/:id': async (users) => {
    const { id, tagId, intact } = await recurrenceOfB(users);
    await users.a.call('patch', `/api/v1/recurrences/${id}`).send({ version: 1, template: { amountCents: 1 } }).expect(404);
    // Sa propre récurrence, pointée vers un tag de B ⇒ 404.
    const [ownAccount, categoryId] = [await accountOfA(users), await systemCategory(users)];
    const { body: own } = await users.a
      .call('post', '/api/v1/recurrences')
      .send({ accountId: ownAccount, interval: 1, unit: 'MONTH', startDate: '2030-01-31', template: { categoryId, amountCents: 100 } })
      .expect(201);
    await users.a.call('patch', `/api/v1/recurrences/${own.id}`).send({ version: 1, template: { tagIds: [tagId] } }).expect(404);
    expect((await users.a.call('get', `/api/v1/recurrences/${own.id}`).expect(200)).body).toEqual(own);
    await intact();
  },
  'DELETE /api/v1/recurrences/:id': async (users) => {
    const { id, intact } = await recurrenceOfB(users);
    await users.a.call('delete', `/api/v1/recurrences/${id}`).expect(404);
    await intact();
  },
  'POST /api/v1/recurrences/:id/restore': async (users) => {
    const { id } = await recurrenceOfB(users);
    await users.b.call('delete', `/api/v1/recurrences/${id}`).expect(204);
    await users.a.call('post', `/api/v1/recurrences/${id}/restore`).expect(404);
    await users.b.call('get', `/api/v1/recurrences/${id}`).expect(404); // toujours supprimée pour B
  },

  'GET /api/v1/stats/by-category': statsOfB('/api/v1/stats/by-category'),
  'GET /api/v1/stats/by-tag': statsOfB('/api/v1/stats/by-tag'),
  'GET /api/v1/stats/monthly': statsOfB('/api/v1/stats/monthly'),

  'GET /api/v1/simulations/loan': sameForBoth('/api/v1/simulations/loan?principalCents=1000000&annualRateBp=500&months=60'),
  'GET /api/v1/simulations/investment': sameForBoth('/api/v1/simulations/investment?initialCents=1000000&annualRateBp=500&months=120'),
  // Projection et objectif sur le compte de B (une dépense de 12,34 €) : 404 pour A.
  'GET /api/v1/simulations/projection': async (users) => {
    const { accountId } = await transactionOfB(users);
    const path = `/api/v1/simulations/projection?accountId=${accountId}&months=1&today=2026-03-31`;
    await users.a.call('get', path).expect(404);
    expect((await users.b.call('get', path).expect(200)).body.points[0]).toEqual({ date: '2026-03-31', balanceCents: -1234 });
  },
  'GET /api/v1/simulations/savings-goal': async (users) => {
    const { accountId } = await transactionOfB(users);
    const path = `/api/v1/simulations/savings-goal?targetCents=100000&months=10&accountId=${accountId}&today=2026-03-31`;
    await users.a.call('get', path).expect(404);
    expect((await users.b.call('get', path).expect(200)).body.savedCents).toBe(-1234);
  },
  'GET /api/v1/scenarios': async (users) => {
    const { id } = await scenarioOfB(users);
    const { body } = await users.a.call('get', '/api/v1/scenarios').expect(200);
    expect(body.map((s: { id: string }) => s.id)).not.toContain(id);
  },
  'POST /api/v1/scenarios': async (users) => {
    const { id: categoryId, intact } = await categoryOfB(users);
    const send = (categoryId: string) =>
      users.a.call('post', '/api/v1/scenarios').send({ name: 'A', params: { changes: [{ kind: 'CATEGORY', categoryId, monthlyDeltaCents: -100 }] } });
    await send(categoryId).expect(404); // catégorie perso de B
    const { body } = await send(await systemCategory(users)).expect(201);
    await users.b.call('get', `/api/v1/scenarios/${body.id}`).expect(404);
    await intact();
  },
  'GET /api/v1/scenarios/:id': async (users) => {
    const { id, intact } = await scenarioOfB(users);
    await users.a.call('get', `/api/v1/scenarios/${id}`).expect(404);
    await intact();
  },
  'PATCH /api/v1/scenarios/:id': async (users) => {
    const { id, intact } = await scenarioOfB(users);
    await users.a.call('patch', `/api/v1/scenarios/${id}`).send({ version: 1, name: 'Piraté' }).expect(404);
    // Son propre scénario, pointé vers une catégorie de B ⇒ 404.
    const { id: categoryId } = await categoryOfB(users);
    const { body: own } = await users.a.call('post', '/api/v1/scenarios').send({ name: 'A', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 1 }] } }).expect(201);
    await users.a
      .call('patch', `/api/v1/scenarios/${own.id}`)
      .send({ version: 1, params: { changes: [{ kind: 'CATEGORY', categoryId, monthlyDeltaCents: -100 }] } })
      .expect(404);
    expect((await users.a.call('get', `/api/v1/scenarios/${own.id}`).expect(200)).body).toEqual(own);
    await intact();
  },
  'DELETE /api/v1/scenarios/:id': async (users) => {
    const { id, intact } = await scenarioOfB(users);
    await users.a.call('delete', `/api/v1/scenarios/${id}`).expect(404);
    await intact();
  },
  // Scénario de B sur le compte de A, ou scénario de A sur le compte de B ⇒ 404.
  'GET /api/v1/scenarios/compare': async (users) => {
    const { id, intact } = await scenarioOfB(users);
    const { accountId: accountOfBId } = await transactionOfB(users);
    const ownAccount = await accountOfA(users);
    const { body: own } = await users.a.call('post', '/api/v1/scenarios').send({ name: 'A', params: { changes: [{ kind: 'SUBSCRIPTION', monthlyCents: 1 }] } }).expect(201);
    const path = (accountId: string, ids: string) => `/api/v1/scenarios/compare?accountId=${accountId}&ids=${ids}&months=1`;
    await users.a.call('get', path(ownAccount, id)).expect(404);
    await users.a.call('get', path(ownAccount, `${own.id},${id}`)).expect(404);
    await users.a.call('get', path(accountOfBId, own.id)).expect(404);
    await users.a.call('get', path(ownAccount, own.id)).expect(200);
    await intact();
  },
};
