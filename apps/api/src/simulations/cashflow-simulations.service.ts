import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CashflowDto, CashflowSimulationDto, CashflowSimulationParams, LocalDate } from '@budgetracker/shared';
import { CashflowSimulation } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { todayUtc } from '../recurrences/recurrences.service';
import { CashflowParamsDto } from './simulations.controller';
import { SimulationsService } from './simulations.service';

export const toCashflowSimulationDto = (s: CashflowSimulation): CashflowSimulationDto => ({
  id: s.id,
  name: s.name,
  params: s.params as unknown as CashflowSimulationParams, // validé par CashflowParamsDto à l'écriture
  version: s.version,
});

// Simulations de trésorerie sauvegardées (SPEC §6.2, PLAN E34). Toute requête filtre userId (404 sinon).
@Injectable()
export class CashflowSimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulations: SimulationsService,
  ) {}

  list(userId: string): Promise<CashflowSimulation[]> {
    return this.prisma.cashflowSimulation.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async get(userId: string, id: string): Promise<CashflowSimulation> {
    const simulation = await this.prisma.cashflowSimulation.findFirst({ where: { id, userId } });
    if (!simulation) throw new NotFoundException();
    return simulation;
  }

  async create(userId: string, name: string, params: CashflowParamsDto, today = todayUtc()): Promise<CashflowSimulation> {
    return this.prisma.cashflowSimulation.create({ data: { userId, name, params: await this.checked(userId, params, today) } });
  }

  async update(userId: string, id: string, version: number, name?: string, params?: CashflowParamsDto, today = todayUtc()): Promise<CashflowSimulation> {
    const data = { name, params: params && (await this.checked(userId, params, today)), version: { increment: 1 } };
    const { count } = await this.prisma.cashflowSimulation.updateMany({ where: { id, userId, version }, data });
    if (count === 0) {
      await this.get(userId, id); // 404 si absente, sinon la version est périmée
      throw new ConflictException('La simulation a été modifiée entre-temps');
    }
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.cashflowSimulation.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
  }

  // Relecture au jour `today` avec les vraies données : solde réel, dépenses de la période en cours, reliquat réparti.
  async result(userId: string, id: string, today = todayUtc()): Promise<CashflowDto> {
    const { params } = toCashflowSimulationDto(await this.get(userId, id));
    if (today > params.endDate) throw new UnprocessableEntityException('Simulation terminée');
    // Une récurrence décochée puis supprimée ne doit pas rendre la simulation illisible.
    const excluded = params.excludedRecurrenceIds?.length
      ? await this.prisma.recurrence.findMany({
          where: { id: { in: params.excludedRecurrenceIds }, userId, accountId: { in: params.accountIds }, deletedAt: null },
          select: { id: true },
        })
      : [];
    const startDate = params.startDate > today ? params.startDate : today;
    return this.simulations.cashflow(userId, { ...params, excludedRecurrenceIds: excluded.map((r) => r.id), startDate, today }, params.startDate);
  }

  // Validée comme un appel direct (comptes, récurrences, dates : 400/404/422), début figé à today par défaut.
  private async checked(userId: string, params: CashflowParamsDto, today: LocalDate): Promise<object> {
    await this.simulations.cashflow(userId, { ...params, today });
    return JSON.parse(JSON.stringify({ ...params, startDate: params.startDate ?? today })) as object;
  }
}
