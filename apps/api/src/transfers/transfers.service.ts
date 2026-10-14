import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TrackingType, TransactionType, TransferDto } from '@budgetracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { checkBalanceChoice, include, toDate, toTransactionDto } from '../transactions/transactions.service';
import { CreateTransferDto, UpdateTransferDto } from './transfers.dto';

// Une opération, deux transactions jumelées par transferId ; Transfer.version est le seul verrou (SPEC §3.4).
// La suppression/restauration d'une jambe passe par TransactionsService (appliquée aux deux).
@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(userId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
    if (!account) throw new NotFoundException('Compte introuvable');
    return account;
  }

  // Visible si le virement et ses deux jambes le sont (un compte supprimé masque ses transactions).
  async get(userId: string, id: string): Promise<TransferDto> {
    const transfer = await this.prisma.transfer.findFirst({
      where: { id, userId, deletedAt: null },
      include: { transactions: { where: { deletedAt: null, account: { deletedAt: null } }, include } },
    });
    const debit = transfer?.transactions.find((t) => t.type === TransactionType.DEBIT);
    const credit = transfer?.transactions.find((t) => t.type === TransactionType.CREDIT);
    if (!transfer || !debit || !credit) throw new NotFoundException();
    return { id: transfer.id, version: transfer.version, debit: toTransactionDto(debit), credit: toTransactionDto(credit) };
  }

  async create(userId: string, { fromAccountId, toAccountId, amountCents, date, name = '', details, countInBalance }: CreateTransferDto): Promise<TransferDto> {
    if (fromAccountId === toAccountId) throw new UnprocessableEntityException('Source et cible identiques');
    const [from, to] = await Promise.all([this.account(userId, fromAccountId), this.account(userId, toAccountId)]);
    // Un portefeuille n'a que des dépenses : il ne peut pas alimenter un autre compte.
    if (from.trackingType === TrackingType.NOT_TRACKED) throw new UnprocessableEntityException('Un compte NOT_TRACKED ne peut pas être source');
    // Même règle que les transactions, jambe par jambe : chaque jambe suit le solde de départ de son compte.
    for (const accountId of [from.id, to.id]) await checkBalanceChoice(this.prisma, userId, accountId, date, countInBalance);
    const leg = { userId, name, details, countInBalance, date: toDate(date), amountCents: BigInt(amountCents) };

    // Vers un portefeuille : seule la jambe source existe, dépense « Espèces » sans jumelage (PLAN §5 hyp. 1).
    if (to.trackingType === TrackingType.NOT_TRACKED) {
      const cash = await this.prisma.category.findUniqueOrThrow({ where: { nameKey: 'cash' } });
      const debit = await this.prisma.transaction.create({ data: { ...leg, accountId: from.id, categoryId: cash.id, type: TransactionType.DEBIT }, include });
      return { id: null, version: null, debit: toTransactionDto(debit), credit: null };
    }

    const { id: categoryId } = await this.prisma.category.findUniqueOrThrow({ where: { nameKey: 'transfer' } });
    const { id } = await this.prisma.transfer.create({
      data: {
        userId,
        transactions: {
          create: [
            { ...leg, categoryId, accountId: from.id, type: TransactionType.DEBIT },
            { ...leg, categoryId, accountId: to.id, type: TransactionType.CREDIT },
          ],
        },
      },
    });
    return this.get(userId, id);
  }

  // Verrou optimiste sur le Transfer : de deux PATCH sur la même version, le second ne trouve plus
  // la ligne (Postgres réévalue le WHERE après le verrou) ⇒ 409, et aucune jambe n'est écrite.
  async update(userId: string, id: string, { version, amountCents, date, ...rest }: UpdateTransferDto): Promise<TransferDto> {
    const { debit, credit } = await this.get(userId, id);
    if (date && date !== debit.date)
      for (const leg of [debit, credit!]) await checkBalanceChoice(this.prisma, userId, leg.accountId, date, rest.countInBalance ?? leg.countInBalance);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transfer.updateMany({ where: { id, userId, deletedAt: null, version }, data: { version: { increment: 1 } } });
      if (count === 0) throw new ConflictException('Le virement a été modifié entre-temps');
      await tx.transaction.updateMany({
        where: { transferId: id, userId },
        data: { ...rest, date: date && toDate(date), amountCents: amountCents === undefined ? undefined : BigInt(amountCents) },
      });
    });
    return this.get(userId, id);
  }
}
