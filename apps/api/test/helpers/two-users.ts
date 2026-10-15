import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../../src/common/cookies';
import { PrismaService } from '../../src/prisma/prisma.service';
import { uniqueEmail } from './db';

const CSRF = 'csrf-test-token';

export interface TestUser {
  id: string;
  // Requête en tant que cet utilisateur : cookie de session + double-submit CSRF. Ex. a.call('get', '/api/v1/me').expect(200).
  call(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string): request.Test;
}

export interface TwoUsers {
  a: TestUser;
  b: TestUser;
  // Données sans route de création utilisateur (ex. notification personnelle, envoyée par l'admin).
  prisma: PrismaService;
  cleanup(): Promise<void>;
}

// Deux utilisateurs vérifiés, session ouverte directement (ni mail ni throttler de login).
export async function createTwoUsers(app: INestApplication): Promise<TwoUsers> {
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const make = async (name: string): Promise<TestUser> => {
    const { id } = await prisma.user.create({ data: { email: uniqueEmail(), name, emailVerifiedAt: new Date() } });
    const { session } = await auth.openSession(id);
    const cookie = `${ACCESS_COOKIE}=${session.access}; ${CSRF_COOKIE}=${CSRF}`;
    return { id, call: (method, url) => request(app.getHttpServer())[method](url).set('Cookie', cookie).set('X-CSRF-Token', CSRF) };
  };
  const [a, b] = await Promise.all([make('A'), make('B')]);
  // Cascade : sessions et données métier partent avec l'utilisateur.
  return { a, b, prisma, cleanup: async () => void (await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } })) };
}
