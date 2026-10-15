import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { trackJob } from './job-runs';

export const PURGE_AFTER_DAYS = 30;

// Suppression définitive des suppressions logiques de plus de 30 jours (SPEC §3.1), tous utilisateurs :
// seule requête sans filtre userId, aucun endpoint. Les cascades BDD emportent tags, pièces jointes
// (lignes) ; un crédit d'intérêts reste (transactionId ⇒ NULL, jamais recréé). Les objets S3 des pièces
// dont la ligne a disparu sont supprimés ensuite (SPEC §4).
@Injectable()
export class PurgeJob {
  private readonly logger = new Logger(PurgeJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  handleCron() {
    return trackJob('purge', () => this.purge(new Date()));
  }

  // Horloge injectée pour les tests.
  async purge(now: Date) {
    const old = { lt: new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000) };
    // Candidates = pièces de tout ce qui est supprimé logiquement (sur-ensemble des cascades ci-dessous) ;
    // seules celles dont la ligne a réellement disparu perdent leur objet (une restauration concurrente est épargnée).
    const deleted = { not: null };
    const candidates = await this.prisma.attachment.findMany({
      where: { transaction: { OR: [{ deletedAt: deleted }, { account: { deletedAt: deleted } }, { transfer: { deletedAt: deleted } }, { transfer: { transactions: { some: { account: { deletedAt: deleted } } } } }] } },
      select: { s3Key: true },
    });
    const [transfers, transactions, recurrences, accounts] = await this.prisma.$transaction([
      // Jambes ensemble (cascade Transfer → Transaction), y compris quand l'une est sur un compte purgé :
      // sinon il resterait une jambe orpheline, ni modifiable ni supprimable.
      this.prisma.transfer.deleteMany({ where: { OR: [{ deletedAt: old }, { transactions: { some: { account: { deletedAt: old } } } }] } }),
      this.prisma.transaction.deleteMany({ where: { deletedAt: old } }),
      // Les occurrences générées restent (recurrenceId ⇒ NULL).
      this.prisma.recurrence.deleteMany({ where: { deletedAt: old } }),
      // Cascade : transactions, récurrences et taux du compte.
      this.prisma.account.deleteMany({ where: { deletedAt: old } }),
    ]);
    const kept = new Set((await this.prisma.attachment.findMany({ where: { s3Key: { in: candidates.map((c) => c.s3Key) } }, select: { s3Key: true } })).map((a) => a.s3Key));
    const gone = candidates.filter((c) => !kept.has(c.s3Key));
    // Après le commit : un échec S3 laisse un objet orphelin journalisé, jamais une ligne sans objet.
    const failed = (await Promise.allSettled(gone.map((c) => this.storage.delete(c.s3Key)))).filter((r) => r.status === 'rejected').length;
    if (failed) this.logger.error(`Purge : ${failed} objet(s) S3 non supprimé(s)`);
    const counts = { transfers: transfers.count, transactions: transactions.count, recurrences: recurrences.count, accounts: accounts.count, attachments: gone.length - failed };
    this.logger.log(`Purge : ${JSON.stringify(counts)}`);
    return counts;
  }
}
