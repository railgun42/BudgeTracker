import { Controller, Delete, Get, INestApplication, RequestMethod, UseGuards } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AdminGuard } from '../../src/common/admin.guard';
import { CSRF_COOKIE } from '../../src/common/cookies';
import { JwtAuthGuard } from '../../src/common/jwt-auth.guard';
import { configureApp } from '../../src/main';
import { adminRoutes, IsolationCheck, isolationRegistry, publicRoutes } from '../helpers/isolation-registry';
import { createTwoUsers, TwoUsers } from '../helpers/two-users';

// Préfixe global posé par configureApp.
const PREFIX = '/api';

interface Guards {
  jwt: boolean;
  admin: boolean;
}

// Route => gardes JwtAuthGuard / AdminGuard (sur la classe ou la méthode), pour toutes les routes des contrôleurs.
function listRoutes(moduleRef: TestingModule): Map<string, Guards> {
  const routes = new Map<string, Guards>();
  const has = (guard: unknown, ...targets: object[]) =>
    targets.some((t) => ((Reflect.getMetadata(GUARDS_METADATA, t) ?? []) as unknown[]).includes(guard));
  for (const { metatype, instance } of moduleRef.get(DiscoveryService).getControllers()) {
    for (const name of new MetadataScanner().getAllMethodNames(Object.getPrototypeOf(instance))) {
      const handler = instance[name];
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      for (const base of [Reflect.getMetadata(PATH_METADATA, metatype!)].flat())
        for (const path of [Reflect.getMetadata(PATH_METADATA, handler)].flat()) {
          const url = `${PREFIX}/${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          routes.set(`${RequestMethod[method]} ${url}`, { jwt: has(JwtAuthGuard, metatype!, handler), admin: has(AdminGuard, metatype!, handler) });
        }
    }
  }
  return routes;
}

const isAdminPath = (route: string) => /^\S+ \/api\/v1\/admin(\/|$)/.test(route);

function coverageErrors(routes: Map<string, Guards>, registry: Record<string, IsolationCheck> = isolationRegistry, admin: string[] = adminRoutes): string[] {
  const errors: string[] = [];
  for (const [route, { jwt: isGuarded, admin: isAdmin }] of routes) {
    if (admin.includes(route)) {
      if (!isGuarded || !isAdmin) errors.push(`${route} : dans adminRoutes mais sans JwtAuthGuard et AdminGuard`);
    } else if (isAdminPath(route)) {
      errors.push(`${route} : route /admin sans règle admin (adminRoutes)`);
    } else if (route in registry) {
      if (!isGuarded) errors.push(`${route} : dans isolationRegistry mais sans JwtAuthGuard`);
    } else if (publicRoutes.includes(route)) {
      if (isGuarded) errors.push(`${route} : dans publicRoutes mais protégée par JwtAuthGuard`);
    } else errors.push(`${route} : absente de test/helpers/isolation-registry.ts`);
  }
  for (const route of [...Object.keys(registry), ...publicRoutes, ...admin]) if (!routes.has(route)) errors.push(`${route} : aucune route correspondante`);
  return errors;
}

@Controller('v1/bidon')
class BidonController {
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get() {}

  // Garde oubliée : doit être signalée même une fois enregistrée.
  @Delete(':id')
  remove() {}
}

// Route d'administration sans AdminGuard : refusée même enregistrée dans adminRoutes.
@Controller('v1/admin/bidon')
@UseGuards(JwtAuthGuard)
class BidonAdminController {
  @Get()
  get() {}
}

describe('Isolation — test méta (e2e)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let users: TwoUsers;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    users = await createTwoUsers(app);
  });

  afterAll(async () => {
    await users?.cleanup();
    await app.close();
  });

  it('chaque route est publique ou a son test d’isolation ; aucune entrée orpheline', () => {
    const routes = listRoutes(moduleRef);
    expect(routes.get('GET /api/v1/me')).toEqual({ jwt: true, admin: false });
    expect(routes.get('GET /api/health')).toEqual({ jwt: false, admin: false });
    expect(routes.get('GET /api/v1/admin/stats')).toEqual({ jwt: true, admin: true });
    expect(coverageErrors(routes)).toEqual([]);
  });

  it('une route bidon fait échouer le méta-test, puis passe une fois enregistrée (si gardée)', async () => {
    const withBidon = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule], controllers: [BidonController] }).compile();
    const routes = listRoutes(withBidon);
    await withBidon.close();

    expect(coverageErrors(routes)).toEqual([
      'GET /api/v1/bidon/:id : absente de test/helpers/isolation-registry.ts',
      'DELETE /api/v1/bidon/:id : absente de test/helpers/isolation-registry.ts',
    ]);
    const noop = async () => undefined;
    expect(coverageErrors(routes, { ...isolationRegistry, 'GET /api/v1/bidon/:id': noop, 'DELETE /api/v1/bidon/:id': noop })).toEqual([
      'DELETE /api/v1/bidon/:id : dans isolationRegistry mais sans JwtAuthGuard',
    ]);
  });

  it('une route /admin sans règle admin fait échouer le méta-test, même dans isolationRegistry ou sans AdminGuard', async () => {
    const withBidon = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule], controllers: [BidonAdminController] }).compile();
    const routes = listRoutes(withBidon);
    await withBidon.close();

    const route = 'GET /api/v1/admin/bidon';
    const noop = async () => undefined;
    expect(coverageErrors(routes)).toEqual([`${route} : route /admin sans règle admin (adminRoutes)`]);
    expect(coverageErrors(routes, { ...isolationRegistry, [route]: noop })).toEqual([`${route} : route /admin sans règle admin (adminRoutes)`]);
    expect(coverageErrors(routes, isolationRegistry, [...adminRoutes, route])).toEqual([`${route} : dans adminRoutes mais sans JwtAuthGuard et AdminGuard`]);
  });

  // Paramètres de chemin remplacés par un UUID quelconque : les gardes répondent avant toute recherche.
  it.each(adminRoutes)('%s : 401 sans session, 403 pour un utilisateur non admin', async (route) => {
    const [method, path] = route.split(' ');
    const url = path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
    const verb = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    // Jeton CSRF valide : seul le défaut de session est en cause.
    await request(app.getHttpServer())[verb](url).set('Cookie', `${CSRF_COOKIE}=x`).set('X-CSRF-Token', 'x').expect(401);
    for (const user of [users.a, users.b]) await user.call(verb, url).expect(403);
  });

  it.each(Object.keys(isolationRegistry))('%s : A ne voit ni ne touche les données de B', (route) => isolationRegistry[route](users));
});
