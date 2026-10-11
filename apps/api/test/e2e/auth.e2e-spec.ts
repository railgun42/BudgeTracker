import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { appUrl, sha256 } from '../../src/auth/auth.service';
import { MailService } from '../../src/mail/mail.service';
import { configureApp } from '../../src/main';
import { testPrisma, uniqueEmail } from '../helpers/db';

// E5/E6 — auth e-mail/mot de passe, reset, Google, contre la vraie base. Le mail est capturé en mémoire.
const CSRF = 'csrf-test-token';
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'new horse battery staple';

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

describe('Auth (e2e)', () => {
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

  // Dernier lien reçu par cette adresse.
  const lastToken = (email: string) => /token=([\w-]+)/.exec(mails.filter((m) => m.to === email).at(-1)!.text)![1];

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
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

  describe('E6 — reset de mot de passe', () => {
    const forgot = async (email: string) => {
      await call('post', '/auth/forgot', { ip: newIp(), body: { email } }).expect(202);
      return lastToken(email);
    };
    const reset = (token: string, password = NEW_PASSWORD) => call('post', '/auth/reset', { ip: newIp(), body: { token, password } });

    it('forgot → reset : nouveau mot de passe actif, ancien refusé, tous les refresh tokens révoqués', async () => {
      const email = await verifiedUser();
      const [a, b] = [jarOf(await login(email).expect(200)), jarOf(await login(email).expect(200))];
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(2);

      const older = await forgot(email);
      const token = await forgot(email);
      expect(mails.at(-1)!.text).toContain(`${appUrl()}/reset-password?token=${token}`);
      await reset(token).expect(204);

      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
      for (const jar of [a, b]) await call('post', '/auth/refresh', { ip: newIp(), cookies: { refresh_token: jar.refresh_token } }).expect(401);
      await login(email).expect(401);
      await login(email, newIp(), NEW_PASSWORD).expect(200);
      // Un lien plus ancien, encore valide en durée, est invalidé par le reset.
      await reset(older).expect(400);
    });

    it('token réutilisé → 400', async () => {
      const token = await forgot(await verifiedUser());
      await reset(token).expect(204);
      await reset(token, 'third horse battery').expect(400);
    });

    it('token expiré → 400, mot de passe inchangé', async () => {
      const email = await verifiedUser();
      const token = await forgot(email);
      await prisma.emailToken.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await reset(token).expect(400);
      await login(email).expect(200);
    });

    it('jeton inconnu ou de vérification d’e-mail → 400 ; mot de passe trop court → 400', async () => {
      await reset('inconnu').expect(400);
      const { token } = await signup();
      await reset(token).expect(400);
      await reset(await forgot(await verifiedUser()), 'court').expect(400);
    });

    it('e-mail inconnu → 202 sans mail ; au-delà de 3 demandes par heure et par compte, plus de mail', async () => {
      const before = mails.length;
      await call('post', '/auth/forgot', { ip: newIp(), body: { email: uniqueEmail() } }).expect(202);
      expect(mails.length).toBe(before);

      const email = await verifiedUser();
      for (let i = 0; i < 4; i++) await call('post', '/auth/forgot', { ip: newIp(), body: { email } }).expect(202);
      expect(mails.filter((m) => m.to === email && m.text.includes('reset-password'))).toHaveLength(3);
    });

    it('le reset vaut vérification de l’adresse d’un compte jamais vérifié', async () => {
      const { email } = await signup();
      await login(email).expect(403);
      await reset(await forgot(email)).expect(204);
      await login(email, newIp(), NEW_PASSWORD).expect(200);
    });
  });

  describe('E6 — Google OAuth', () => {
    const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
    const googleClaims = (email: string, emailVerified = true) => ({
      iss: 'https://accounts.google.com',
      aud: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: `g-${email}`,
      email,
      email_verified: emailVerified,
      name: 'Ann Google',
    });

    // Parcours navigateur : /auth/google → (Google) → /auth/google/callback, échange de code simulé.
    const googleLogin = async (claims: object, tamper?: { state?: string; noCookie?: boolean }) => {
      const start = await call('get', '/auth/google', { ip: newIp(), csrf: false }).expect(302);
      const authorize = new URL(start.headers.location);
      const oauthState = jarOf(start).oauth_state;
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id_token: idToken(claims) })));
      try {
        const state = tamper?.state ?? authorize.searchParams.get('state');
        const cookies: Jar = tamper?.noCookie ? {} : { oauth_state: oauthState };
        const res = await call('get', `/auth/google/callback?code=abc&state=${state}`, { ip: newIp(), cookies, csrf: false }).expect(302);
        return { start, authorize, oauthState, res, fetchCalls: [...fetchSpy.mock.calls] };
      } finally {
        fetchSpy.mockRestore();
      }
    };

    it('nouvel utilisateur : redirection avec state + PKCE, compte vérifié créé, session ouverte', async () => {
      const email = uniqueEmail();
      emails.push(email);
      const { start, authorize, oauthState, res, fetchCalls } = await googleLogin(googleClaims(email));

      expect(authorize.origin + authorize.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(authorize.searchParams.get('client_id')).toBe('test-client');
      expect(authorize.searchParams.get('redirect_uri')).toBe(`${appUrl()}/api/v1/auth/google/callback`);
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
      const stateCookie = setCookies(start).find((c) => c.startsWith('oauth_state='))!;
      expect(stateCookie).toMatch(/HttpOnly/);
      expect(stateCookie).toMatch(/Secure/);
      expect(stateCookie).toMatch(/SameSite=Lax/);

      // Le vérificateur PKCE envoyé à Google correspond au challenge de la redirection.
      const body = new URLSearchParams(String(fetchCalls[0][1]!.body));
      expect(body.get('code')).toBe('abc');
      expect(oauthState.endsWith(`.${body.get('code_verifier')}`)).toBe(true);
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'));

      expect(res.headers.location).toBe(`${appUrl()}/`);
      const jar = jarOf(res);
      expect(jar.refresh_token).toBeDefined();
      const me = await call('get', '/me', { ip: newIp(), cookies: { access_token: jar.access_token } }).expect(200);
      expect(me.body).toMatchObject({ email, name: 'Ann Google' });
      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { credential: true, oauthIdentities: true } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.credential).toBeNull();
      expect(user.oauthIdentities).toEqual([expect.objectContaining({ provider: 'google', providerId: `g-${email}` })]);

      // Deuxième connexion : même compte, pas de doublon.
      await googleLogin(googleClaims(email));
      expect(await prisma.oAuthIdentity.count({ where: { userId: user.id } })).toBe(1);
    });

    it('compte local vérifié + e-mail Google vérifié ⇒ liaison ; le mot de passe reste valable', async () => {
      const email = await verifiedUser();
      const { res } = await googleLogin(googleClaims(email));
      const me = await call('get', '/me', { ip: newIp(), cookies: { access_token: jarOf(res).access_token } }).expect(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(me.body.id).toBe(user.id);
      expect(await prisma.oAuthIdentity.count({ where: { userId: user.id } })).toBe(1);
      await login(email).expect(200);
    });

    it('e-mail Google non vérifié, ou compte local non vérifié ⇒ refus de liaison, pas de session', async () => {
      const verifiedEmail = await verifiedUser();
      const { email: unverifiedEmail } = await signup();
      for (const claims of [googleClaims(verifiedEmail, false), googleClaims(unverifiedEmail)]) {
        const { res } = await googleLogin(claims);
        expect(res.headers.location).toBe(`${appUrl()}/login?error=google_link_refused`);
        expect(jarOf(res).access_token).toBeUndefined();
      }
      expect(await prisma.oAuthIdentity.count({ where: { user: { email: { in: [verifiedEmail, unverifiedEmail] } } } })).toBe(0);
    });

    it('state différent ou cookie absent ⇒ erreur, Google jamais appelé', async () => {
      const email = await verifiedUser();
      for (const tamper of [{ state: 'forged' }, { noCookie: true }]) {
        const { res, fetchCalls } = await googleLogin(googleClaims(email), tamper);
        expect(res.headers.location).toBe(`${appUrl()}/login?error=google`);
        expect(fetchCalls).toHaveLength(0);
        expect(jarOf(res).access_token).toBeUndefined();
      }
    });

    it('non configuré ⇒ 404', async () => {
      const id = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      try {
        await call('get', '/auth/google', { ip: newIp(), csrf: false }).expect(404);
      } finally {
        process.env.GOOGLE_CLIENT_ID = id;
      }
    });
  });
});
