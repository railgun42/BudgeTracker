import { ForbiddenException, Injectable, NotFoundException, PreconditionFailedException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { appUrl, TERMS_VERSION } from './auth.service';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const PROVIDER = 'google';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

// L'id_token vient directement du endpoint token de Google, par TLS, en échange du code et du secret :
// sa signature n'a pas à être revérifiée (OIDC Core §3.1.3.7), ses claims si.
export function profileFromIdToken(idToken: string, clientId: string, nowMs = Date.now()): GoogleProfile {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('id_token invalide');
  }
  const { iss, aud, exp, sub, email, email_verified, name } = claims;
  const valid =
    ISSUERS.has(iss as string) && aud === clientId && typeof exp === 'number' && exp * 1000 > nowMs &&
    typeof sub === 'string' && typeof email === 'string';
  if (!valid) throw new UnauthorizedException('id_token invalide');
  return { sub, email: email.toLowerCase(), emailVerified: email_verified === true, name: typeof name === 'string' ? name : undefined };
}

@Injectable()
export class GoogleService {
  constructor(private readonly prisma: PrismaService) {}

  // Lu à chaque appel : la connexion Google est facultative en dev (404 si non configurée).
  private config() {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
    if (!clientId || !clientSecret) throw new NotFoundException('Connexion Google non configurée');
    // Même origine que le front en prod (Caddy) comme en dev (proxy Angular).
    return { clientId, clientSecret, redirectUri: `${appUrl()}/api/v1/auth/google/callback` };
  }

  // PKCE (S256) en plus du state, recommandé même pour un client confidentiel.
  authorizationUrl(state: string, verifier: string): string {
    const { clientId, redirectUri } = this.config();
    return `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })}`;
  }

  async exchangeCode(code: string, verifier: string): Promise<GoogleProfile> {
    const { clientId, clientSecret, redirectUri } = this.config();
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new UnauthorizedException('Code Google refusé');
    const { id_token } = (await res.json()) as { id_token?: string };
    return profileFromIdToken(id_token ?? '', clientId);
  }

  // Liaison par e-mail uniquement s'il est vérifié des deux côtés (SPEC §5) : sinon un tiers ayant
  // pré-inscrit l'adresse d'une victime, ou un e-mail Google non prouvé, donnerait accès au compte d'autrui.
  // Un nouveau compte exige le consentement CGU (E29c) ; un compte existant se connecte ou se lie sans.
  async resolveUser(profile: GoogleProfile, termsAccepted = false): Promise<string> {
    const identity = { provider: PROVIDER, providerId: profile.sub };
    const linked = await this.prisma.oAuthIdentity.findUnique({ where: { provider_providerId: identity } });
    if (linked) return linked.userId;
    if (!profile.emailVerified) throw new ForbiddenException('E-mail Google non vérifié');

    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing && !existing.emailVerifiedAt) throw new ForbiddenException('Compte existant non vérifié');
    if (existing) {
      await this.prisma.oAuthIdentity.create({ data: { userId: existing.id, ...identity } });
      return existing.id;
    }
    if (!termsAccepted) throw new PreconditionFailedException('CGU non acceptées');
    const name = (profile.name?.trim() || profile.email.split('@')[0]).slice(0, 100);
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        name,
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
        oauthIdentities: { create: identity },
      },
    });
    return user.id;
  }
}
