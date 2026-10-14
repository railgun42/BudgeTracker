import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { toLocalDate } from '../transactions/transactions.service';

type Row = Record<string, unknown>;
export type ExportData = Record<string, Row[]>;

// Colonnes DATE (jour sans fuseau) ; les autres Date sont des horodatages UTC.
const DAY_FIELDS = new Set(['date', 'occurrenceDate', 'startDate', 'endDate', 'lastGeneration', 'effectiveDate']);

// Frontière de sérialisation (PLAN §1.3) : BigInt ⇒ centimes en number, DATE ⇒ 'YYYY-MM-DD', horodatage ⇒ ISO UTC.
const plain = (row: object): Row =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Date ? (DAY_FIELDS.has(k) ? toLocalDate(v) : v.toISOString()) : v]),
  );

// Une section par table : titre, en-tête, lignes. « ; » : séparateur attendu par les tableurs en français.
export function toCsv(data: ExportData): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const line = (values: unknown[]) => values.map(cell).join(';');
  const sections = Object.entries(data).map(([name, rows]) => {
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return [name, line(columns), ...rows.map((r) => line(columns.map((c) => r[c])))].join('\r\n');
  });
  // BOM : Excel lit alors l'UTF-8 (accents).
  return `\uFEFF${sections.join('\r\n\r\n')}\r\n`;
}

// RGPD (SPEC §8) : export de toutes les données de l'utilisateur, suppression réelle du compte.
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Toutes les tables sauf les secrets d'authentification (Credential, EmailToken, RefreshToken : hashes).
  // Lignes supprimées logiquement comprises : elles sont encore stockées. Instantané cohérent (RepeatableRead).
  async export(userId: string): Promise<ExportData> {
    const mine = { userId };
    const p = this.prisma;
    // ponytail: tout en mémoire ; flux par table si des comptes dépassent quelques centaines de milliers de lignes.
    const tables = await p.$transaction(
      [
        p.user.findMany({ where: { id: userId } }),
        p.oAuthIdentity.findMany({ where: mine }),
        p.account.findMany({ where: mine }),
        p.transfer.findMany({ where: mine }),
        p.transaction.findMany({ where: mine, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
        p.category.findMany({ where: mine }),
        p.tag.findMany({ where: mine }),
        p.transactionTag.findMany({ where: { transaction: mine } }),
        // Clé S3 : détail interne de stockage, pas une donnée de l'utilisateur.
        p.attachment.findMany({ where: mine, omit: { s3Key: true } }),
        p.recurrence.findMany({ where: mine }),
        p.transactionTemplate.findMany({ where: { recurrence: mine } }),
        p.templateTag.findMany({ where: { template: { recurrence: mine } } }),
        p.interestRate.findMany({ where: mine }),
        p.interestCredit.findMany({ where: { account: mine } }),
        p.scenario.findMany({ where: mine }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const names = ['User', 'OAuthIdentity', 'Account', 'Transfer', 'Transaction', 'Category', 'Tag', 'TransactionTag', 'Attachment', 'Recurrence', 'TransactionTemplate', 'TemplateTag', 'InterestRate', 'InterestCredit', 'Scenario'];
    return Object.fromEntries(names.map((name, i) => [name, (tables[i] as object[]).map(plain)]));
  }

  // Cascade BDD (schéma) : sessions, identités, données métier, lignes de pièces jointes, en une requête.
  // Puis tout le préfixe S3 de l'utilisateur, orphelins compris. Un upload concurrent échoue sur la ligne et retire son objet.
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.deleteMany({ where: { id: userId } });
    await this.storage.deletePrefix(`attachments/${userId}/`).catch((e: Error) =>
      // ponytail: compte déjà effacé en base ; objets restants journalisés, à retirer à la main (préfixe dans le log).
      this.logger.error(`Suppression de compte : objets S3 attachments/${userId}/ non supprimés : ${e.message}`),
    );
    this.logger.log(`Compte ${userId} supprimé`);
  }
}
