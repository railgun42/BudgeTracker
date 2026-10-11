import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const PURGE_AFTER_DAYS = 30;

// Suppression définitive des suppressions logiques de plus de 30 jours (SPEC §3.1), tous utilisateurs :
// seule requête sans filtre userId, aucun endpoint. Les cascades BDD emportent tags, pièces jointes
// (lignes) et crédits d'intérêts ; les objets S3 seront supprimés en E23.
@Injectable()
export class PurgeJob {
  private readonly logger = new Logger(PurgeJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  handleCron() {
    return this.purge(new Date());
  }

  // Horloge injectée pour les tests.
  async purge(now: Date) {
    const old = { lt: new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000) };
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
    const counts = { transfers: transfers.count, transactions: transactions.count, recurrences: recurrences.count, accounts: accounts.count };
    this.logger.log(`Purge : ${JSON.stringify(counts)}`);
    return counts;
  }
}
