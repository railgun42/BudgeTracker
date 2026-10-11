import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import * as shared from '@budgetracker/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { bootstrap, configureApp } from '../../src/main';

class EchoDto {
  @IsString()
  name!: string;
}

// Routes de test pour vérifier le ValidationPipe et le filtre d'erreurs globaux.
@Controller('test')
class ProbeController {
  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }

  @Get('boom')
  boom() {
    throw new Error('secret interne alice@example.com');
  }
}

describe('Squelette API (e2e)', () => {
  let app: INestApplication;
  // Double-submit CSRF exigé sur toute méthode non sûre (E5).
  const post = (url: string) => request(app.getHttpServer()).post(url).set('Cookie', 'csrf_token=t').set('X-CSRF-Token', 't');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/health → 200 avec en-têtes de sécurité helmet', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('ValidationPipe : champ non déclaré → 400', async () => {
    const res = await post('/api/test/echo').send({ name: 'a', balance: 10 }).expect(400);
    expect(JSON.stringify(res.body)).toContain('balance should not exist');
  });

  it('ValidationPipe : type invalide → 400, valide → 201', async () => {
    await post('/api/test/echo').send({ name: 42 }).expect(400);
    await post('/api/test/echo').send({ name: 'a' }).expect(201, { name: 'a' });
  });

  it("filtre d'erreurs : erreur inattendue → 500 générique sans fuite", async () => {
    const res = await request(app.getHttpServer()).get('/api/test/boom').expect(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it('route inconnue → 404 au format JSON', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.statusCode).toBe(404);
  });
});

describe('Démarrage (e2e)', () => {
  it('refuse de démarrer si une variable obligatoire manque', async () => {
    await expect(bootstrap({ PORT: '0' })).rejects.toThrow(/DATABASE_URL/);
  });

  it('démarre et répond sur /api/health avec une config valide', async () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const app = await bootstrap({ DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32), PORT: '0' });
    stdout.mockRestore();
    try {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    } finally {
      await app.close();
    }
  });

  it('@budgetracker/shared se résout depuis l’API (point de contrôle R1)', () => {
    expect(require.resolve('@budgetracker/shared')).toMatch(/packages[\\/]shared[\\/]dist[\\/]index\.js$/);
    expect(typeof shared).toBe('object');
  });
});
