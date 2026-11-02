import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AttachmentDto, AttachmentUrlDto, DocumentDto } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { live, toLocalDate, TransactionsService } from '../transactions/transactions.service';
import { detectMime } from './file-signature';

// Champs utiles du fichier multer (stockage mémoire, taille déjà bornée à 5 Mo par l'intercepteur).
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

type Db = Prisma.TransactionClient | PrismaService;

// Nom d'origine : affichage seulement (jamais un chemin), sans caractères de contrôle.
const displayName = (name: string) => [...name].filter((c) => c >= ' ' && c !== '\x7f').join('').slice(0, 255) || 'fichier';

// Document visible dans le coffre : déposé directement, ou pièce d'une transaction hors corbeille.
const visible = (userId: string) => ({ userId, OR: [{ transactionId: null }, { transaction: live(userId) }] }) satisfies Prisma.AttachmentWhereInput;
const documentInclude = { tags: { select: { tagId: true } }, transaction: { select: { id: true, name: true, date: true, accountId: true } } } satisfies Prisma.AttachmentInclude;
type DocumentRow = Prisma.AttachmentGetPayload<{ include: typeof documentInclude }>;
const toDocumentDto = ({ id, originalName, mime, sizeBytes, createdAt, tags, transaction: t }: DocumentRow): DocumentDto => ({
  id,
  originalName,
  mime,
  sizeBytes,
  createdAt: createdAt.toISOString(),
  tagIds: tags.map((x) => x.tagId),
  transaction: t && { id: t.id, name: t.name, date: toLocalDate(t.date), accountId: t.accountId },
});

// 0..1 pièce par transaction (SPEC §4), ou document déposé directement dans le coffre (transactionId null).
// Transaction d'un autre utilisateur ou supprimée ⇒ 404 (TransactionsService.get).
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly transactions: TransactionsService,
  ) {}

  private async checkQuota(db: Db, userId: string, size: number): Promise<void> {
    const { storageQuotaBytes } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { storageQuotaBytes: true } });
    const { _sum } = await db.attachment.aggregate({ where: { userId }, _sum: { sizeBytes: true } });
    if ((_sum.sizeBytes ?? 0) + size > Number(storageQuotaBytes)) throw new UnprocessableEntityException('Quota de stockage dépassé');
  }

  async upload(userId: string, transactionId: string | null, file: UploadedFileLike | undefined): Promise<AttachmentDto> {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file »)');
    if (transactionId && (await this.transactions.get(userId, transactionId)).attachment) throw new ConflictException('Cette transaction a déjà une pièce jointe');
    const mime = detectMime(file.buffer);
    if (!mime) throw new UnsupportedMediaTypeException('Formats acceptés : JPEG, PNG, WebP, PDF');
    // Pré-contrôle sans verrou : un fichier hors quota ne part pas vers S3.
    await this.checkQuota(this.prisma, userId, file.size);

    // Clé générée serveur ; l'objet est envoyé avant la ligne : un arrêt entre les deux laisse au pire
    // un objet orphelin invisible, jamais une ligne sans objet.
    const s3Key = `attachments/${userId}/${randomUUID()}`;
    await this.storage.put(s3Key, file.buffer, mime);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Verrou sur l'utilisateur : des uploads parallèles ne dépassent pas le quota à eux tous (PLAN R11).
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        await this.checkQuota(tx, userId, file.size);
        return tx.attachment.create({ data: { userId, transactionId, s3Key, originalName: displayName(file.originalname), mime, sizeBytes: file.size } });
      });
      return { id: row.id, originalName: row.originalName, mime: row.mime, sizeBytes: row.sizeBytes };
    } catch (e) {
      await this.storage.delete(s3Key).catch((err: Error) => this.logger.error(`Objet orphelin ${s3Key} : ${err.message}`));
      // transactionId unique : deux uploads simultanés sur la même transaction.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Cette transaction a déjà une pièce jointe');
      throw e;
    }
  }

  async url(userId: string, transactionId: string): Promise<AttachmentUrlDto> {
    const { attachment } = await this.transactions.get(userId, transactionId);
    if (!attachment) throw new NotFoundException();
    return { url: await this.storage.signedUrl(attachment.s3Key, attachment.mime) };
  }

  async remove(userId: string, transactionId: string): Promise<void> {
    const { attachment } = await this.transactions.get(userId, transactionId);
    if (!attachment) throw new NotFoundException();
    await this.removeRow(userId, attachment);
  }

  // ponytail: liste complète sans pagination (quota 200 Mo ⇒ quelques milliers de lignes au plus) ; curseur si le quota grandit.
  async listDocuments(userId: string): Promise<DocumentDto[]> {
    const rows = await this.prisma.attachment.findMany({ where: visible(userId), include: documentInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    return rows.map(toDocumentDto);
  }

  private async document(userId: string, id: string): Promise<DocumentRow> {
    const row = await this.prisma.attachment.findFirst({ where: { id, ...visible(userId) }, include: documentInclude });
    if (!row) throw new NotFoundException();
    return row;
  }

  async documentUrl(userId: string, id: string, download: boolean): Promise<AttachmentUrlDto> {
    const { s3Key, mime, originalName } = await this.document(userId, id);
    return { url: await this.storage.signedUrl(s3Key, mime, download ? originalName : undefined) };
  }

  async setTags(userId: string, id: string, tagIds: string[]): Promise<DocumentDto> {
    await this.document(userId, id);
    const ids = [...new Set(tagIds)];
    await this.transactions.checkTags(userId, ids);
    await this.prisma.$transaction([
      this.prisma.attachmentTag.deleteMany({ where: { attachmentId: id } }),
      this.prisma.attachmentTag.createMany({ data: ids.map((tagId) => ({ attachmentId: id, tagId })) }),
    ]);
    return toDocumentDto(await this.document(userId, id));
  }

  async removeDocument(userId: string, id: string): Promise<void> {
    await this.removeRow(userId, await this.document(userId, id));
  }

  private async removeRow(userId: string, attachment: { id: string; s3Key: string }): Promise<void> {
    const { count } = await this.prisma.attachment.deleteMany({ where: { id: attachment.id, userId } });
    if (count === 0) throw new NotFoundException();
    // ponytail: échec S3 après la suppression de la ligne ⇒ objet orphelin journalisé (hors quota) ; balayage du bucket si ça arrive.
    // Ligne d'abord : l'inverse laisserait une pièce affichée mais illisible.
    await this.storage.delete(attachment.s3Key).catch((err: Error) => this.logger.error(`Objet orphelin ${attachment.s3Key} : ${err.message}`));
  }
}
