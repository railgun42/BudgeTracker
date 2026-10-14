import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EmailTokenType, Prisma, User } from '../generated/prisma/client';
import { REFRESH_TTL_MS } from '../common/cookies';
import { RecurrencesService, todayUtc } from '../recurrences/recurrences.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, SignupDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';

const VERIFY_TTL_MS = 24 * 3600_000;
// Version des CGU acceptée à l'inscription : à changer à chaque révision des CGU (apps/web/.../legal).
export const TERMS_VERSION = '2026-10-14';
// Deux onglets qui rafraîchissent en même temps ne doivent pas être pris pour un vol (PLAN R8).
export const REFRESH_GRACE_MS = 10_000;
// Verrouillage progressif par compte : 1 min après 5 échecs, doublé à chaque échec suivant, 1 h max.
const MAX_FAILURES = 5;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 3600_000;

export const randomToken = () => randomBytes(32).toString('base64url');
// Jetons à forte entropie : un SHA-256 suffit, seul le hash est stocké.
export const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
// URL du front, pour les liens envoyés par e-mail et les redirections OAuth.
export const appUrl = () => process.env.APP_URL || 'http://localhost:4200';

// Usage unique : la consommation est conditionnelle, donc atomique. Renvoie l'id de l'utilisateur.
export async function consumeEmailToken(tx: Prisma.TransactionClient, token: string, type: EmailTokenType): Promise<string> {
  const now = new Date();
  const row = await tx.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  const { count } = row
    ? await tx.emailToken.updateMany({ where: { id: row.id, type, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
    : { count: 0 };
  if (!row || !count) throw new BadRequestException('Lien invalide ou expiré');
  return row.userId;
}

export interface Session {
  access: string;
  /** Absent pendant la fenêtre de grâce : le navigateur a déjà le nouveau cookie. */
  refresh?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // ponytail: compteur en mémoire (un seul processus API), à déplacer en BDD/Redis si plusieurs instances.
  // Taille bornée en pratique par le throttler par IP.
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly recurrences: RecurrencesService,
  ) {}

  // Réponse identique que l'e-mail existe ou non (pas d'énumération de comptes).
  async signup({ email, name, password }: SignupDto): Promise<void> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user
      .create({ data: { email, name, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, credential: { create: { passwordHash } } } })
      .catch((e: { code?: string }) => {
        if (e.code === 'P2002') return null;
        throw e;
      });
    if (!user) return;
    const token = randomToken();
    await this.prisma.emailToken.create({
      data: { userId: user.id, type: 'VERIFY', tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    });
    const link = `${appUrl()}/verify-email?token=${token}`;
    await this.mail.send(email, 'Confirmez votre adresse e-mail', `Bienvenue sur BudgeTracker.\n\nConfirmez votre adresse : ${link}\n\nCe lien expire dans 24 h.`);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const userId = await consumeEmailToken(tx, token, 'VERIFY');
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    });
  }

  async login({ email, password }: LoginDto): Promise<{ user: User; session: Required<Session> }> {
    const failure = this.failures.get(email);
    if (failure && failure.lockedUntil > Date.now()) {
      throw new HttpException('Trop de tentatives, réessayez plus tard', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email }, include: { credential: true } });
    // Hash factice si l'utilisateur n'existe pas : même temps de réponse.
    const hash = user?.credential?.passwordHash ?? (await (this.dummyHash ??= hashPassword(randomToken())));
    if (!(await verifyPassword(password, hash)) || !user?.credential?.passwordHash) {
      this.recordFailure(email);
      throw new UnauthorizedException('Identifiants invalides');
    }
    this.failures.delete(email);
    // Vérifié après le mot de passe : ne révèle rien sans connaître celui-ci.
    if (!user.emailVerifiedAt) throw new ForbiddenException('Adresse e-mail non vérifiée');
    return this.openSession(user.id);
  }

  // Nouvelle session (nouvelle famille de refresh tokens) : login par mot de passe ou par Google.
  async openSession(userId: string): Promise<{ user: User; session: Required<Session> }> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { lastConnection: new Date() } });
    // Rattrapage des récurrences (SPEC §3.6) ; un échec ne bloque pas la connexion, le job quotidien reprendra.
    await this.recurrences.generateForUser(userId, todayUtc()).catch((e: Error) => this.logger.error(`Rattrapage des récurrences : ${e.message}`));
    return { user, session: await this.createSession(userId, randomUUID()) };
  }

  // Rotation : chaque refresh token ne sert qu'une fois. Rejouer un ancien jeton révoque toute la famille.
  async refresh(token: string | undefined): Promise<Session> {
    if (!token) throw new UnauthorizedException();
    const tokenHash = sha256(token);
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!row || row.expiresAt <= now) throw new UnauthorizedException();
      // Conditionnel : deux requêtes concurrentes ne peuvent pas toutes deux faire tourner le jeton.
      const { count } = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
      return count ? this.createSession(row.userId, row.familyId, tx) : null;
    });
    if (rotated) return rotated;

    const row = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash } });
    const { familyId, revokedAt } = row;
    const [revokedSince, active] = await Promise.all([
      this.prisma.refreshToken.count({ where: { familyId, revokedAt: { gt: revokedAt! } } }),
      this.prisma.refreshToken.count({ where: { familyId, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    // Grâce : jeton tout juste remplacé, et son successeur pas encore utilisé.
    if (now.getTime() - revokedAt!.getTime() < REFRESH_GRACE_MS && revokedSince === 0 && active === 1) {
      return { access: await this.jwt.signAsync({ sub: row.userId }) };
    }
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
    throw new UnauthorizedException();
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async createSession(userId: string, familyId: string, db: Pick<PrismaService, 'refreshToken'> = this.prisma): Promise<Required<Session>> {
    const refresh = randomToken();
    await db.refreshToken.create({
      data: { userId, familyId, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    });
    return { access: await this.jwt.signAsync({ sub: userId }), refresh };
  }

  private recordFailure(email: string): void {
    const f = this.failures.get(email) ?? { count: 0, lockedUntil: 0 };
    f.count++;
    if (f.count >= MAX_FAILURES) f.lockedUntil = Date.now() + Math.min(LOCK_BASE_MS * 2 ** (f.count - MAX_FAILURES), LOCK_MAX_MS);
    this.failures.set(email, f);
  }
}
