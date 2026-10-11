import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/mail/mail.service';
import { configureApp } from '../../src/main';
import { testPrisma, uniqueEmail } from '../helpers/db';

// E5 — auth e-mail/mot de passe, contre la vraie base. Le mail est capturé en mémoire.
const CSRF = 'csrf-test-token';
const PASSWORD = 'correct horse battery';

type Jar = Record<string, string>;
interface CallOptions {
  ip: string;
  cookies?: Jar;
  body?: object;
  csrf?: boolean;
}

// Une IP distincte par scénario (X-Forwarded-For, trust proxy) : le throttler par IP ne déborde pas d'un test à l'autre.
let ipSeq = 0;
const newIp = () => `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

// supertest/cookiejar n'envoie pas les cookies Secure en HTTP : on gère le jar à la main.
const setCookies = (res: request.Response): string[] => ([] as string[]).concat(res.headers['set-cookie'] ?? []);
const jarOf = (res: request.Response): Jar =>
  Object.fromEntries(setCookies(res).map((c) => c.split(';')[0].split('=') as [string, string]).filter(([, v]) => v));

describe('Auth e-mail/mot de passe (e2e)', () => {
  let app: INestApplication;
  const prisma = testPrisma();
  const mails: { to: string; text: string }[] = [];
  const emails: string[] = [];

  const call = (method: 'get' | 'post', path: string, { ip, cookies = {}, body, csrf = true }: CallOptions) => {
    const jar = csrf ? { ...cookies, csrf_token: CSRF } : cookies;
    let req = request(app.getHttpServer())[method](`/api/v1${path}`).set('X-Forwarded-For', ip);
    if (Object.keys(jar).length) req = req.set('Cookie', Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '));
    if (csrf) req = req.set('X-CSRF-Token', CSRF);
    return body ? req.send(body) : req;
  };

  const signup = async (ip = newIp()) => {
    const email = uniqueEmail();
    emails.push(email);
    await call('post', '/auth/signup', { ip, body: { email, name: 'Alice', password: PASSWORD } }).expect(202);
    const token = /token=([\w-]+)/.exec(mails.find((m) => m.to === email)!.text)![1];
    return { email, token };
  };

  const verifiedUser = async () => {
    const { email, token } = await signup();
    await call('post', '/auth/verify-email', { ip: newIp(), body: { token } }).expect(204);
    return email;
  };

  const login = (email: string, ip = newIp(), password = PASSWORD) =>
    call('post', '/auth/login', { ip, body: { email, password } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async (to: string, _subject: string, text: string) => void mails.push({ to, text }) })
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('signup → mail capturé → verify → login → GET /me 200, sans jeton dans les corps', async () => {
    const { email, token } = await signup();
    const credential = await prisma.credential.findFirstOrThrow({ where: { user: { email } } });
    expect(credential.passwordHash).toMatch(/^\$argon2id\$/);

    await call('post', '/auth/verify-email', { ip: newIp(), body: { token } }).expect(204);
    // Usage unique.
    await call('post', '/auth/verify-email', { ip: newIp(), body: { token } }).expect(400);

    const res = await login(email).expect(200);
    const jar = jarOf(res);
    expect(res.body).toEqual({ id: expect.any(String), email, name: 'Alice', lastConnection: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain(jar.access_token);
    expect(JSON.stringify(res.body)).not.toContain(jar.refresh_token);
    for (const name of ['access_token', 'refresh_token']) {
      const cookie = setCookies(res).find((c) => c.startsWith(`${name}=`))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
    }

    const me = await call('get', '/me', { ip: newIp(), cookies: { access_token: jar.access_token } }).expect(200);
    expect(me.body).toEqual(res.body);
    await call('get', '/me', { ip: newIp() }).expect(401);
    await call('get', '/me', { ip: newIp(), cookies: { access_token: `${jar.access_token}x` } }).expect(401);
  });

  it('lien de vérification inconnu → 400', async () => {
    await call('post', '/auth/verify-email', { ip: newIp(), body: { token: 'inconnu' } }).expect(400);
  });

  it('login non vérifié → 403 ; mot de passe faux → 401 ; e-mail inconnu → 401', async () => {
    const { email } = await signup();
    await login(email).expect(403);
    await login(email, newIp(), 'wrong password!').expect(401);
    await login(uniqueEmail()).expect(401);
  });

  it('e-mail en majuscules normalisé ; inscription en double → 202 sans mail ni doublon', async () => {
    const email = await verifiedUser();
    await login(email.toUpperCase()).expect(200);
    const before = mails.length;
    await call('post', '/auth/signup', { ip: newIp(), body: { email, name: 'Bob', password: PASSWORD } }).expect(202);
    expect(mails.length).toBe(before);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('validation : mot de passe trop court, champ inconnu → 400', async () => {
    const body = { email: uniqueEmail(), name: 'A', password: 'court' };
    await call('post', '/auth/signup', { ip: newIp(), body }).expect(400);
    await call('post', '/auth/signup', { ip: newIp(), body: { ...body, password: PASSWORD, isAdmin: true } }).expect(400);
  });

  it('6ᵉ essai rapide depuis la même IP → 429', async () => {
    const ip = newIp();
    for (let i = 0; i < 5; i++) await login(uniqueEmail(), ip).expect(401);
    await login(uniqueEmail(), ip).expect(429);
  });

  it('verrouillage par compte : 5 échecs depuis des IP différentes → 429 même avec le bon mot de passe', async () => {
    const email = await verifiedUser();
    for (let i = 0; i < 5; i++) await login(email, newIp(), 'wrong password!').expect(401);
    await login(email).expect(429);
  });

  it('refresh : nouveau jeton à chaque rotation ; rejouer un ancien jeton révoque la famille', async () => {
    const email = await verifiedUser();
    const a = jarOf(await login(email).expect(200)).refresh_token;

    const resB = await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: a } }).expect(204);
    expect(resB.body).toEqual({});
    const b = jarOf(resB);
    expect(b.refresh_token).toBeDefined();
    expect(b.refresh_token).not.toBe(a);
    await call('get', '/me', { ip: newIp(), cookies: { access_token: b.access_token } }).expect(200);

    const c = jarOf(await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: b.refresh_token } }).expect(204));

    // A est rejoué après que son successeur a lui-même tourné : vol présumé.
    await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: a } }).expect(401);
    await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: c.refresh_token } }).expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('refresh concurrent (R8) : l’ancien jeton rejoué aussitôt → accès renouvelé sans révoquer la famille', async () => {
    const email = await verifiedUser();
    const a = jarOf(await login(email).expect(200)).refresh_token;
    const b = jarOf(await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: a } }).expect(204));

    const grace = await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: a } }).expect(204);
    expect(jarOf(grace).access_token).toBeDefined();
    expect(jarOf(grace).refresh_token).toBeUndefined();
    await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: b.refresh_token } }).expect(204);
  });

  it('logout révoque la session et efface les cookies', async () => {
    const jar = jarOf(await login(await verifiedUser()).expect(200));
    const res = await call('post', '/auth/logout', { ip: newIp(), cookies: jar }).expect(204);
    expect(setCookies(res).filter((c) => /^(access|refresh)_token=;/.test(c))).toHaveLength(2);
    await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: jar.refresh_token } }).expect(401);
  });

  it('CSRF : POST sans jeton ou avec un jeton différent → 403 ; un GET pose le cookie', async () => {
    const email = await verifiedUser();
    await call('post', '/auth/login', { ip: newIp(), body: { email, password: PASSWORD }, csrf: false }).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', `csrf_token=${CSRF}`)
      .set('X-CSRF-Token', 'autre')
      .send({ email, password: PASSWORD })
      .expect(403);

    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    const cookie = setCookies(res).find((c) => c.startsWith('csrf_token='))!;
    expect(cookie).not.toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });
});
