import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LocalDate, TrackingType, TransactionDto, TransactionPage, TransactionType } from '@budgetracker/shared';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, TransactionListQueryDto, UpdateTransactionDto } from './transactions.dto';

export const include = { tags: { select: { tagId: true } }, attachment: true } satisfies Prisma.TransactionInclude;
export type TransactionRow = Prisma.TransactionGetPayload<{ include: typeof include }>;

// 'YYYY-MM-DD' ⇄ minuit UTC : jour inchangé en @db.Date quel que soit le fuseau du serveur.
export const toDate = (d: LocalDate) => new Date(d);
const toLocalDate = (d: Date): LocalDate => d.toISOString().slice(0, 10);

export const toTransactionDto = (t: TransactionRow): TransactionDto => ({
  id: t.id,
  accountId: t.accountId,
  name: t.name,
  date: toLocalDate(t.date),
  amountCents: Number(t.amountCents),
  type: t.type as TransactionType,
  details: t.details,
  categoryId: t.categoryId,
  tagIds: t.tags.map((tag) => tag.tagId).sort(),
  transferId: t.transferId,
  recurrenceId: t.recurrenceId,
  attachment: t.attachment && { id: t.attachment.id, originalName: t.attachment.originalName, mime: t.attachment.mime, sizeBytes: t.attachment.sizeBytes },
  version: t.version,
});

// Visible : à l'utilisateur, non supprimée, sur un compte non supprimé (PLAN §5 hyp. 11).
const live = (userId: string) => ({ userId, deletedAt: null, account: { deletedAt: null } }) satisfies Prisma.TransactionWhereInput;

// Compte, catégorie ou tag d'un autre utilisateur ⇒ 404, comme une ressource absente.
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async checkAccount(userId: string, id: string, type: TransactionType): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
    if (!account) throw new NotFoundException('Compte introuvable');
    // NOT_TRACKED : portefeuille sans entrées (SPEC §3.2).
    if (type === TransactionType.CREDIT && account.trackingType === TrackingType.NOT_TRACKED)
      throw new UnprocessableEntityException('Un compte NOT_TRACKED n’accepte pas de CREDIT');
  }

  private async checkCategory(userId: string, id: string): Promise<void> {
    if (!(await this.prisma.category.findFirst({ where: { id, OR: [{ userId: null }, { userId }] } }))) throw new NotFoundException('Catégorie introuvable');
  }

  private async checkTags(userId: string, ids: string[]): Promise<void> {
    if ((await this.prisma.tag.count({ where: { id: { in: ids }, userId } })) !== ids.length) throw new NotFoundException('Tag introuvable');
  }

  async list(userId: string, { cursor, limit = 50, from, to, accountId, categoryId, tagId }: TransactionListQueryDto): Promise<TransactionPage> {
    const after = cursor ? decodeCursor(cursor) : undefined;
    if (accountId && !(await this.prisma.account.count({ where: { id: accountId, userId, deletedAt: null } }))) throw new NotFoundException('Compte introuvable');
    if (categoryId) await this.checkCategory(userId, categoryId);
    if (tagId) await this.checkTags(userId, [tagId]);
    const rows = await this.prisma.transaction.findMany({
      where: {
        ...live(userId),
        accountId,
        categoryId,
        tags: tagId ? { some: { tagId } } : undefined,
        date: { gte: from && toDate(from), lte: to && toDate(to) },
        // Strictement après le curseur dans l'ordre (date, id) décroissant : ni doublon ni trou à date égale.
        OR: after && [{ date: { lt: toDate(after.date) } }, { date: toDate(after.date), id: { lt: after.id } }],
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const items = rows.slice(0, limit).map(toTransactionDto);
    return { items, nextCursor: rows.length > limit ? encodeCursor(items[limit - 1]) : null };
  }

  async get(userId: string, id: string): Promise<TransactionRow> {
    const transaction = await this.prisma.transaction.findFirst({ where: { id, ...live(userId) }, include });
    if (!transaction) throw new NotFoundException();
    return transaction;
  }

  async create(userId: string, dto: CreateTransactionDto): Promise<TransactionRow> {
    const { accountId, categoryId, amountCents, date, type = TransactionType.DEBIT, name = '', details, tagIds = [] } = dto;
    await this.checkAccount(userId, accountId, type);
    await this.checkCategory(userId, categoryId);
    await this.checkTags(userId, tagIds);
    return this.prisma.transaction.create({
      data: {
        userId,
        accountId,
        categoryId,
        name,
        details,
        type,
        date: toDate(date),
        amountCents: BigInt(amountCents),
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include,
    });
  }

  // Verrou optimiste : l'écriture n'a lieu que si la version lue est encore la version en base.
  async update(userId: string, id: string, { version, accountId, categoryId, amountCents, date, tagIds, ...rest }: UpdateTransactionDto): Promise<TransactionRow> {
    const current = await this.get(userId, id);
    if (current.transferId) throw new UnprocessableEntityException('Jambe de virement : modifier via /transfers/:id');
    await this.checkAccount(userId, accountId ?? current.accountId, rest.type ?? (current.type as TransactionType));
    if (categoryId) await this.checkCategory(userId, categoryId);
    if (tagIds) await this.checkTags(userId, tagIds);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transaction.updateMany({
        where: { id, ...live(userId), version },
        data: {
          ...rest,
          accountId,
          categoryId,
          date: date && toDate(date),
          amountCents: amountCents === undefined ? undefined : BigInt(amountCents),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictException('La transaction a été modifiée entre-temps');
      if (tagIds) {
        await tx.transactionTag.deleteMany({ where: { transactionId: id } });
        await tx.transactionTag.createMany({ data: tagIds.map((tagId) => ({ transactionId: id, tagId })) });
      }
    });
    return this.get(userId, id);
  }

  // Virement : le Transfer et ses jambes partagent la suppression logique ; seule la version du Transfer bouge.
  private async setTransferDeleted(userId: string, transferId: string, deletedAt: Date | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transfer.updateMany({
        where: { id: transferId, userId, deletedAt: deletedAt ? null : { not: null } },
        data: { deletedAt, version: { increment: 1 } },
      });
      if (count === 0) throw new NotFoundException();
      await tx.transaction.updateMany({ where: { transferId, userId }, data: { deletedAt } });
    });
  }

  // Jambe de virement ⇒ les deux jambes sont supprimées (SPEC §3.4).
  async remove(userId: string, id: string): Promise<void> {
    const { transferId } = await this.get(userId, id);
    if (transferId) return this.setTransferDeleted(userId, transferId, new Date());
    const { count } = await this.prisma.transaction.updateMany({
      where: { id, ...live(userId) },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundException();
  }

  // Seule requête qui vise les supprimées : annulation depuis l'UI, avant la purge à 30 jours.
  async restore(userId: string, id: string): Promise<TransactionRow> {
    const deleted = await this.prisma.transaction.findFirst({ where: { id, userId, deletedAt: { not: null } }, select: { transferId: true } });
    if (deleted?.transferId) {
      // Les deux comptes doivent être visibles, sinon le virement réapparaîtrait à moitié.
      if (await this.prisma.transaction.count({ where: { transferId: deleted.transferId, userId, account: { deletedAt: { not: null } } } })) throw new NotFoundException();
      await this.setTransferDeleted(userId, deleted.transferId, null);
      return this.get(userId, id);
    }
    const { count } = await this.prisma.transaction.updateMany({
      where: { id, userId, deletedAt: { not: null }, account: { deletedAt: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundException();
    return this.get(userId, id);
  }
}
