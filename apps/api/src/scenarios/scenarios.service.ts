import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { addMonths, ScenarioComparisonDto, ScenarioDto, ScenarioParams, TransactionType } from '@budgetracker/shared';
import { Scenario } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { projection } from '../simulations/engine/projection';
import { applyScenario } from '../simulations/engine/scenario';
import { SimulationsService } from '../simulations/simulations.service';
import { toDate } from '../transactions/transactions.service';
import { CompareScenariosQueryDto, CreateScenarioDto, ScenarioParamsDto, UpdateScenarioDto } from './scenarios.dto';

export const toScenarioDto = (s: Scenario): ScenarioDto => ({
  id: s.id,
  name: s.name,
  params: s.params as unknown as ScenarioParams, // validé par ScenarioParamsDto à l'écriture
  version: s.version,
});

// Instances de DTO ⇒ JSON simple pour la colonne `params`.
const toJson = (params: ScenarioParamsDto) => JSON.parse(JSON.stringify(params)) as object;

// Toute requête filtre userId (404 sinon). La comparaison ne fait que lire : aucune écriture hors du CRUD des scénarios.
@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulations: SimulationsService,
  ) {}

  list(userId: string): Promise<Scenario[]> {
    return this.prisma.scenario.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async get(userId: string, id: string): Promise<Scenario> {
    const scenario = await this.prisma.scenario.findFirst({ where: { id, userId } });
    if (!scenario) throw new NotFoundException();
    return scenario;
  }

  async create(userId: string, { name, params }: CreateScenarioDto): Promise<Scenario> {
    await this.checkCategories(userId, params);
    return this.prisma.scenario.create({ data: { userId, name, params: toJson(params) } });
  }

  async update(userId: string, id: string, { version, name, params }: UpdateScenarioDto): Promise<Scenario> {
    if (params) await this.checkCategories(userId, params);
    const { count } = await this.prisma.scenario.updateMany({
      where: { id, userId, version },
      data: { name, params: params && toJson(params), version: { increment: 1 } },
    });
    if (count === 0) {
      await this.get(userId, id); // 404 si absent, sinon la version est périmée
      throw new ConflictException('Le scénario a été modifié entre-temps');
    }
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.scenario.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
  }

  async compare(userId: string, { ids, ...query }: CompareScenariosQueryDto): Promise<ScenarioComparisonDto> {
    const scenarios = await this.prisma.scenario.findMany({ where: { id: { in: ids }, userId } });
    if (scenarios.length !== ids.length) throw new NotFoundException();
    const input = await this.simulations.projectionInput(userId, query); // 404/422 sur le compte
    const changes = new Map(scenarios.map((s) => [s.id, toScenarioDto(s)]));
    const categoryIds = [...new Set([...changes.values()].flatMap((s) => s.params.changes.flatMap((c) => (c.kind === 'CATEGORY' ? [c.categoryId] : []))))];
    const spend = await this.categorySpend(userId, query.accountId, categoryIds, input.today, input.windowMonths);
    return {
      baseline: projection(input),
      scenarios: ids.map((id) => {
        const { name, params } = changes.get(id)!;
        return { id, name, projection: projection(applyScenario(input, params.changes, spend)) };
      }),
    };
  }

  // Catégories système ou de l'utilisateur ; sinon 404.
  private async checkCategories(userId: string, { changes }: ScenarioParams): Promise<void> {
    const ids = [...new Set(changes.flatMap((c) => (c.kind === 'CATEGORY' ? [c.categoryId] : [])))];
    if (!ids.length) return;
    const found = await this.prisma.category.count({ where: { id: { in: ids }, OR: [{ userId: null }, { userId }] } });
    if (found !== ids.length) throw new NotFoundException('Catégorie introuvable');
  }

  // Dépense mensuelle moyenne de chaque catégorie (sous-catégories comprises) sur la fenêtre de la projection,
  // récurrences comprises, hors virements : plafond des économies d'un scénario.
  private async categorySpend(userId: string, accountId: string, ids: string[], today: string, windowMonths: number): Promise<Record<string, number>> {
    if (!ids.length) return {};
    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      _sum: { amountCents: true },
      where: {
        userId,
        accountId,
        deletedAt: null,
        type: TransactionType.DEBIT,
        transferId: null,
        date: { gt: toDate(addMonths(today, -windowMonths)), lte: toDate(today) },
        OR: [{ categoryId: { in: ids } }, { category: { parentId: { in: ids } } }],
      },
    });
    const parents = new Map(
      (await this.prisma.category.findMany({ where: { id: { in: rows.map((r) => r.categoryId) } }, select: { id: true, parentId: true } })).map((c) => [c.id, c.parentId]),
    );
    const total: Record<string, number> = {};
    for (const { categoryId, _sum } of rows) {
      const key = ids.includes(categoryId) ? categoryId : parents.get(categoryId)!;
      total[key] = (total[key] ?? 0) + Number(_sum.amountCents ?? 0);
    }
    return Object.fromEntries(Object.entries(total).map(([id, cents]) => [id, Math.round(cents / windowMonths)]));
  }
}
