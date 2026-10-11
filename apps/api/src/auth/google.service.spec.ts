import { UnauthorizedException } from '@nestjs/common';
import { GoogleProfile, GoogleService, profileFromIdToken } from './google.service';

const NOW = Date.UTC(2026, 0, 1);
const claims = { iss: 'https://accounts.google.com', aud: 'client', exp: NOW / 1000 + 60, sub: '42', email: 'Ann@Example.com', email_verified: true, name: 'Ann' };
const idToken = (c: object) => `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`;

describe('profileFromIdToken', () => {
  it('extrait un profil normalisé', () => {
    expect(profileFromIdToken(idToken(claims), 'client', NOW)).toEqual({ sub: '42', email: 'ann@example.com', emailVerified: true, name: 'Ann' });
    expect(profileFromIdToken(idToken({ ...claims, email_verified: 'true' }), 'client', NOW).emailVerified).toBe(false);
  });

  it.each([
    ['autre audience', { ...claims, aud: 'other' }],
    ['autre émetteur', { ...claims, iss: 'https://evil.example' }],
    ['expiré', { ...claims, exp: NOW / 1000 }],
    ['sans e-mail', { ...claims, email: undefined }],
  ])('rejette un id_token %s', (_, c) => {
    expect(() => profileFromIdToken(idToken(c), 'client', NOW)).toThrow(UnauthorizedException);
  });

  it('rejette un id_token mal formé', () => {
    expect(() => profileFromIdToken('garbage', 'client', NOW)).toThrow(UnauthorizedException);
    expect(() => profileFromIdToken('', 'client', NOW)).toThrow(UnauthorizedException);
  });
});

// Stratégie de liaison avec un profil simulé et une base factice en mémoire.
describe('GoogleService.resolveUser', () => {
  const setup = (users: { id: string; email: string; emailVerifiedAt: Date | null }[], identities: { userId: string; providerId: string }[] = []) => {
    const prisma = {
      oAuthIdentity: {
        findUnique: async ({ where }: { where: { provider_providerId: { providerId: string } } }) =>
          identities.find((i) => i.providerId === where.provider_providerId.providerId) ?? null,
        create: jest.fn(async ({ data }: { data: { userId: string; providerId: string } }) => void identities.push(data)),
      },
      user: {
        findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) ?? null,
        create: jest.fn(async () => ({ id: 'new' })),
      },
    };
    return { prisma, service: new GoogleService(prisma as never) };
  };
  const profile = (p: Partial<GoogleProfile> = {}): GoogleProfile => ({ sub: 'g1', email: 'ann@example.com', emailVerified: true, ...p });
  const verified = { id: 'u1', email: 'ann@example.com', emailVerifiedAt: new Date() };

  it('e-mail Google non vérifié ⇒ refus de liaison, rien créé', async () => {
    const { prisma, service } = setup([verified]);
    await expect(service.resolveUser(profile({ emailVerified: false }))).rejects.toThrow('E-mail Google non vérifié');
    expect(prisma.oAuthIdentity.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('compte local existant non vérifié ⇒ refus de liaison (pré-inscription par un tiers)', async () => {
    const { prisma, service } = setup([{ ...verified, emailVerifiedAt: null }]);
    await expect(service.resolveUser(profile())).rejects.toThrow('Compte existant non vérifié');
    expect(prisma.oAuthIdentity.create).not.toHaveBeenCalled();
  });

  it('e-mail vérifié des deux côtés ⇒ liaison au compte existant', async () => {
    const { prisma, service } = setup([verified]);
    await expect(service.resolveUser(profile())).resolves.toBe('u1');
    expect(prisma.oAuthIdentity.create).toHaveBeenCalledWith({ data: { userId: 'u1', provider: 'google', providerId: 'g1' } });
  });

  it('identité déjà liée ⇒ même utilisateur, même si l’e-mail Google a changé', async () => {
    const { service } = setup([verified], [{ userId: 'u1', providerId: 'g1' }]);
    await expect(service.resolveUser(profile({ email: 'autre@example.com', emailVerified: false }))).resolves.toBe('u1');
  });

  it('e-mail inconnu et vérifié ⇒ création d’un compte vérifié, sans mot de passe', async () => {
    const { prisma, service } = setup([]);
    await expect(service.resolveUser(profile({ name: '  ' }))).resolves.toBe('new');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'ann@example.com', name: 'ann', emailVerifiedAt: expect.any(Date), oauthIdentities: { create: { provider: 'google', providerId: 'g1' } } },
    });
  });
});
