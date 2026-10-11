import { Controller, Delete, Get, INestApplication, RequestMethod, UseGuards } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/common/jwt-auth.guard';
import { configureApp } from '../../src/main';
import { IsolationCheck, isolationRegistry, publicRoutes } from '../helpers/isolation-registry';
import { createTwoUsers, TwoUsers } from '../helpers/two-users';

// Préfixe global posé par configureApp.
const PREFIX = '/api';

// Route => protégée par JwtAuthGuard (sur la classe ou la méthode), pour toutes les routes des contrôleurs.
function listRoutes(moduleRef: TestingModule): Map<string, boolean> {
  const routes = new Map<string, boolean>();
  const guarded = (target: object) => ((Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[]).includes(JwtAuthGuard);
  for (const { metatype, instance } of moduleRef.get(DiscoveryService).getControllers()) {
    for (const name of new MetadataScanner().getAllMethodNames(Object.getPrototypeOf(instance))) {
      const handler = instance[name];
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      for (const base of [Reflect.getMetadata(PATH_METADATA, metatype!)].flat())
        for (const path of [Reflect.getMetadata(PATH_METADATA, handler)].flat()) {
          const url = `${PREFIX}/${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          routes.set(`${RequestMethod[method]} ${url}`, guarded(metatype!) || guarded(handler));
        }
    }
  }
  return routes;
}

function coverageErrors(routes: Map<string, boolean>, registry: Record<string, IsolationCheck> = isolationRegistry): string[] {
  const errors: string[] = [];
  for (const [route, isGuarded] of routes) {
    if (route in registry) {
      if (!isGuarded) errors.push(`${route} : dans isolationRegistry mais sans JwtAuthGuard`);
    } else if (publicRoutes.includes(route)) {
      if (isGuarded) errors.push(`${route} : dans publicRoutes mais protégée par JwtAuthGuard`);
    } else errors.push(`${route} : absente de test/helpers/isolation-registry.ts`);
  }
  for (const route of [...Object.keys(registry), ...publicRoutes]) if (!routes.has(route)) errors.push(`${route} : aucune route correspondante`);
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
    expect(routes.get('GET /api/v1/me')).toBe(true);
    expect(routes.get('GET /api/health')).toBe(false);
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

  it.each(Object.keys(isolationRegistry))('%s : A ne voit ni ne touche les données de B', (route) => isolationRegistry[route](users));
});
