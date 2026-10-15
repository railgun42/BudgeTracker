import { Injectable } from '@nestjs/common';
import { AdminStatsDto } from '@budgetracker/shared';
import { serverErrorCount } from '../common/all-exceptions.filter';
import { jobRuns } from '../jobs/job-runs';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
const startedAt = new Date();

// Statistiques d'administration (SPEC §13.2) : seule lecture tous utilisateurs confondus, et uniquement des
// comptages ou des tailles. Aucun e-mail, aucun montant, aucune ligne d'un utilisateur ne sort d'ici.
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(now = new Date()): Promise<AdminStatsDto> {
    const since = (days: number) => ({ gte: new Date(now.getTime() - days * DAY_MS) });
    const t0 = performance.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
    const alive = { deletedAt: null };
    const [total, verified, new7d, new30d, active7d, active30d, accounts, transactions, recurrences, attachments, storage, [db]] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      this.prisma.user.count({ where: { createdAt: since(7) } }),
      this.prisma.user.count({ where: { createdAt: since(30) } }),
      this.prisma.user.count({ where: { lastConnection: since(7) } }),
      this.prisma.user.count({ where: { lastConnection: since(30) } }),
      this.prisma.account.count({ where: alive }),
      // Transaction d'un compte supprimé logiquement : masquée comme dans le reste de l'API.
      this.prisma.transaction.count({ where: { ...alive, account: alive } }),
      this.prisma.recurrence.count({ where: alive }),
      this.prisma.attachment.count(),
      this.prisma.attachment.aggregate({ _sum: { sizeBytes: true } }),
      this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
    ]);
    return {
      users: { total, verified, new7d, new30d, active7d, active30d },
      volumes: { accounts, transactions, recurrences, attachments, storageBytes: Number(storage._sum.sizeBytes ?? 0) },
      database: { sizeBytes: Number(db.size), latencyMs },
      api: {
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        memoryRssBytes: process.memoryUsage().rss,
        errorsSinceStart: serverErrorCount(),
        jobs: { ...jobRuns },
      },
    };
  }
}
