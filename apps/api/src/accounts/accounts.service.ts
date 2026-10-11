import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AccountDto, TrackingType } from '@budgetracker/shared';
import { Account } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';

export const toAccountDto = (a: Account): AccountDto => ({
  id: a.id,
  name: a.name,
  trackingType: a.trackingType as TrackingType,
  version: a.version,
});

// Toute requête filtre userId : la ressource d'un autre utilisateur est indiscernable d'une ressource absente (404).
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<Account[]> {
    return this.prisma.account.findMany({ where: { userId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async get(userId: string, id: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id, userId, deletedAt: null } });
    if (!account) throw new NotFoundException();
    return account;
  }

  async create(userId: string, { name, trackingType, openingBalance }: CreateAccountDto): Promise<Account> {
    if (openingBalance && trackingType === TrackingType.NOT_TRACKED)
      throw new UnprocessableEntityException('Un compte NOT_TRACKED n’a pas de solde de départ');
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: { userId, name, trackingType } });
      if (openingBalance) {
        const category = await tx.category.findUniqueOrThrow({ where: { nameKey: 'opening_balance' } });
        await tx.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId: category.id,
            name: 'Solde de départ',
            date: new Date(openingBalance.date), // 'YYYY-MM-DD' ⇒ minuit UTC, jour inchangé en @db.Date
            amountCents: BigInt(Math.abs(openingBalance.amountCents)),
            type: openingBalance.amountCents > 0 ? 'CREDIT' : 'DEBIT',
          },
        });
      }
      return account;
    });
  }

  // Verrou optimiste : l'écriture n'a lieu que si la version lue est encore la version en base.
  async update(userId: string, id: string, { version, name, trackingType }: UpdateAccountDto): Promise<Account> {
    const { count } = await this.prisma.account.updateMany({
      where: { id, userId, deletedAt: null, version },
      data: { name, trackingType, version: { increment: 1 } },
    });
    if (count === 0) {
      await this.get(userId, id); // 404 si absent, sinon la version est périmée
      throw new ConflictException('Le compte a été modifié entre-temps');
    }
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.account.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundException();
  }

  // Seule requête qui vise les supprimés : annulation depuis l'UI, avant la purge à 30 jours.
  async restore(userId: string, id: string): Promise<Account> {
    const { count } = await this.prisma.account.updateMany({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundException();
    return this.get(userId, id);
  }
}
