import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { addDays, IntervalUnit, LocalDate, RecurrenceDto, TransactionType } from '@budgetracker/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toDate, toLocalDate, TransactionsService } from '../transactions/transactions.service';
import { occurrencesBetween } from './engine/occurrences';
import { CreateRecurrenceDto, UpdateRecurrenceDto } from './recurrences.dto';

const include = { template: { include: { tags: { select: { tagId: true } } } } } satisfies Prisma.RecurrenceInclude;
type RecurrenceRow = Prisma.RecurrenceGetPayload<{ include: typeof include }>;

// Jour du serveur (UTC), comme le solde actuel par défaut.
export const todayUtc = (): LocalDate => new Date().toISOString().slice(0, 10);

// Large : jusqu'à 20 générations concurrentes d'une même récurrence attendent le verrou ou une connexion du pool.
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

export const toRecurrenceDto = (r: RecurrenceRow): RecurrenceDto => ({
  id: r.id,
  accountId: r.accountId,
  interval: r.interval,
  unit: r.unit as IntervalUnit,
  startDate: toLocalDate(r.startDate),
  endDate: r.endDate && toLocalDate(r.endDate),
  template: {
    name: r.template!.name,
    amountCents: Number(r.template!.amountCents),
    type: r.template!.type as TransactionType,
    categoryId: r.template!.categoryId,
    details: r.template!.details,
    tagIds: r.template!.tags.map((t) => t.tagId).sort(),
  },
  version: r.version,
});

// Visible : à l'utilisateur, non supprimée, sur un compte non supprimé.
const live = (userId: string) => ({ userId, deletedAt: null, account: { deletedAt: null } }) satisfies Prisma.RecurrenceWhereInput;

// Verrou consultatif par récurrence, relâché au COMMIT : les générations concurrentes (job, connexion, onglets) se sérialisent.
const lock = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;

// Occurrences matérialisées côté serveur jusqu'à aujourd'hui (PLAN §5 hyp. 2) ; le modèle est lu à la génération.
@Injectable()
export class RecurrencesService {
  private readonly logger = new Logger(RecurrencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  list(userId: string): Promise<RecurrenceRow[]> {
    return this.prisma.recurrence.findMany({ where: live(userId), include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async get(userId: string, id: string): Promise<RecurrenceRow> {
    const recurrence = await this.prisma.recurrence.findFirst({ where: { id, ...live(userId) }, include });
    if (!recurrence) throw new NotFoundException();
    return recurrence;
  }

  async create(userId: string, { accountId, interval, unit, startDate, endDate = null, template }: CreateRecurrenceDto, today: LocalDate): Promise<RecurrenceRow> {
    const { amountCents, type = TransactionType.DEBIT, name = '', details, tagIds = [] } = template;
    await this.transactions.checkAccount(userId, accountId, type);
    const categoryId = await this.transactions.resolveCategory(userId, template.categoryId, template.subcategoryId);
    await this.transactions.checkTags(userId, tagIds);
    if (endDate && endDate < startDate) throw new UnprocessableEntityException('endDate antérieure à startDate');
    const { id } = await this.prisma.recurrence.create({
      data: {
        userId,
        accountId,
        interval,
        unit,
        startDate: toDate(startDate),
        endDate: endDate && toDate(endDate),
        anchorDay: Number(startDate.slice(8)),
        template: { create: { categoryId, name, details, type, amountCents: BigInt(amountCents), tags: { create: tagIds.map((tagId) => ({ tagId })) } } },
      },
    });
    await this.generate(userId, id, today);
    return this.get(userId, id);
  }

  // SPEC §3.6 : sous le verrou, les occurrences déjà dues sont générées avec l'ancien modèle, puis le modèle change.
  // scope 'future' (défaut) : aucune transaction existante n'est réécrite ; 'all' : les champs envoyés sont aussi
  // appliqués aux occurrences non supprimées (une retouche individuelle est écrasée, une occurrence supprimée reste supprimée).
  async update(userId: string, id: string, { version, scope = 'future', endDate, template = {} }: UpdateRecurrenceDto, today: LocalDate): Promise<RecurrenceRow> {
    const current = await this.get(userId, id);
    const { tagIds, amountCents, categoryId, subcategoryId, ...rest } = template;
    await this.transactions.checkAccount(userId, current.accountId, rest.type ?? (current.template!.type as TransactionType));
    const category = categoryId === undefined && !subcategoryId ? undefined : await this.transactions.resolveCategory(userId, categoryId, subcategoryId);
    if (tagIds) await this.transactions.checkTags(userId, tagIds);
    if (endDate && endDate < toLocalDate(current.startDate)) throw new UnprocessableEntityException('endDate antérieure à startDate');
    await this.prisma.$transaction(async (tx) => {
      await lock(tx, id);
      await this.generateIn(tx, userId, id, today);
      const { count } = await tx.recurrence.updateMany({
        where: { id, ...live(userId), version },
        data: { endDate: endDate === undefined ? undefined : endDate && toDate(endDate), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictException('La récurrence a été modifiée entre-temps');
      const fields = { ...rest, categoryId: category, amountCents: amountCents === undefined ? undefined : BigInt(amountCents) };
      await tx.transactionTemplate.update({
        where: { recurrenceId: id, recurrence: { userId } },
        data: { ...fields, tags: tagIds && { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } },
      });
      if (scope === 'all') {
        const past = { recurrenceId: id, userId, deletedAt: null };
        await tx.transaction.updateMany({ where: past, data: { ...fields, version: { increment: 1 } } });
        if (tagIds) {
          const ids = (await tx.transaction.findMany({ where: past, select: { id: true } })).map((t) => t.id);
          await tx.transactionTag.deleteMany({ where: { transactionId: { in: ids } } });
          await tx.transactionTag.createMany({ data: ids.flatMap((transactionId) => tagIds.map((tagId) => ({ transactionId, tagId }))) });
        }
      }
    }, TX_OPTIONS);
    return this.get(userId, id);
  }

  // Les occurrences déjà créées restent : ce sont des transactions ordinaires.
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.recurrence.updateMany({ where: { id, ...live(userId) }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    if (count === 0) throw new NotFoundException();
  }

  // Annulation depuis l'UI ; les occurrences manquées pendant la suppression sont rattrapées à la prochaine génération.
  async restore(userId: string, id: string): Promise<RecurrenceRow> {
    const { count } = await this.prisma.recurrence.updateMany({
      where: { id, userId, deletedAt: { not: null }, account: { deletedAt: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    if (count === 0) throw new NotFoundException();
    return this.get(userId, id);
  }

  /** Crée les occurrences dues jusqu'à `today` ; renvoie le nombre de transactions créées. */
  generate(userId: string, id: string, today: LocalDate): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await lock(tx, id);
      return this.generateIn(tx, userId, id, today);
    }, TX_OPTIONS);
  }

  // Rattrapage à la connexion : toutes les récurrences de l'utilisateur en retard sur `today`.
  generateForUser(userId: string, today: LocalDate): Promise<number> {
    return this.generateDue({ userId }, today);
  }

  // Job quotidien, tous utilisateurs : seule sélection sans filtre userId (comme la purge) ; chaque génération filtre ensuite par userId.
  generateAll(today: LocalDate): Promise<number> {
    return this.generateDue({}, today);
  }

  private async generateDue(where: { userId?: string }, today: LocalDate): Promise<number> {
    const due = await this.prisma.recurrence.findMany({
      where: { ...where, deletedAt: null, account: { deletedAt: null }, OR: [{ lastGeneration: null }, { lastGeneration: { lt: toDate(today) } }] },
      select: { id: true, userId: true },
    });
    let created = 0;
    for (const { id, userId } of due) {
      // Une récurrence en échec ne bloque pas les autres ; elle sera reprise au prochain passage.
      created += await this.generate(userId, id, today).catch((e: Error) => (this.logger.error(`Génération de ${id} : ${e.message}`), 0));
    }
    return created;
  }

  // Appelé sous le verrou. Seulement les dates > lastGeneration : une occurrence supprimée puis purgée (la contrainte
  // unique ne la protège plus) n'est jamais recréée (PLAN R3). ON CONFLICT DO NOTHING en seconde ligne de défense.
  private async generateIn(tx: Prisma.TransactionClient, userId: string, id: string, today: LocalDate): Promise<number> {
    const r = await tx.recurrence.findFirst({ where: { id, ...live(userId) }, include });
    if (!r?.template) return 0;
    const last = r.lastGeneration && toLocalDate(r.lastGeneration);
    if (last && last >= today) return 0;
    const rule = { startDate: toLocalDate(r.startDate), endDate: r.endDate && toLocalDate(r.endDate), interval: r.interval, unit: r.unit as IntervalUnit };
    const dates = occurrencesBetween(rule, last ? addDays(last, 1) : rule.startDate, today);
    const t = r.template;
    const created = dates.length
      ? await tx.transaction.createManyAndReturn({
          data: dates.map((d) => ({
            userId,
            accountId: r.accountId,
            recurrenceId: id,
            occurrenceDate: toDate(d),
            date: toDate(d),
            name: t.name,
            details: t.details,
            type: t.type,
            categoryId: t.categoryId,
            amountCents: t.amountCents,
          })),
          skipDuplicates: true,
          select: { id: true },
        })
      : [];
    if (created.length && t.tags.length) {
      await tx.transactionTag.createMany({ data: created.flatMap(({ id: transactionId }) => t.tags.map(({ tagId }) => ({ transactionId, tagId }))) });
    }
    await tx.recurrence.updateMany({ where: { id, userId }, data: { lastGeneration: toDate(today) } });
    return created.length;
  }
}
