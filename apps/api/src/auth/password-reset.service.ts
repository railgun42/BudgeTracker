import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { appUrl, consumeEmailToken, randomToken, sha256 } from './auth.service';
import { hashPassword } from './password';

const RESET_TTL_MS = 30 * 60_000;
// Par compte, en plus du throttler par IP : au plus 3 e-mails de reset par heure.
const MAX_RESETS_PER_HOUR = 3;

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Réponse identique que l'e-mail existe ou non (pas d'énumération de comptes).
  async forgot(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const recent = await this.prisma.emailToken.count({
      where: { userId: user.id, type: 'RESET', createdAt: { gt: new Date(Date.now() - 3600_000) } },
    });
    if (recent >= MAX_RESETS_PER_HOUR) return;
    const token = randomToken();
    await this.prisma.emailToken.create({
      data: { userId: user.id, type: 'RESET', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const link = `${appUrl()}/reset-password?token=${token}`;
    await this.mail.send(
      email,
      'Réinitialisation de votre mot de passe',
      `Réinitialisez votre mot de passe : ${link}\n\nCe lien expire dans 30 minutes et ne sert qu'une fois.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    );
  }

  async reset(token: string, password: string): Promise<void> {
    // Hors transaction : Argon2 est lent.
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const userId = await consumeEmailToken(tx, token, 'RESET');
      const now = new Date();
      // Les autres liens de reset encore en circulation deviennent inutilisables.
      await tx.emailToken.updateMany({ where: { userId, type: 'RESET', usedAt: null }, data: { usedAt: now } });
      // Upsert : un compte Google seul peut ainsi se donner un mot de passe.
      await tx.credential.upsert({ where: { userId }, create: { userId, passwordHash }, update: { passwordHash } });
      // Toutes les sessions sont fermées (les jetons d'accès expirent d'eux-mêmes sous 15 min).
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      // Le lien reçu prouve la possession de l'adresse.
      await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    });
  }
}
