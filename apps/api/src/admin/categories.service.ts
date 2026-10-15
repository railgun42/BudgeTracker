import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TECHNICAL_CATEGORY_KEYS } from '@budgetracker/shared';
import { Category, Prisma } from '../generated/prisma/client';
import { AdminUpdateCategoryDto, CreateCategoryDto } from '../categories/categories.dto';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL = { userId: null };

// P2002 : index unique (parentId, lower(name)) des globales (migration global_categories).
const duplicate = (e: { code?: string }): never => {
  if (e.code === 'P2002') throw new ConflictException('Une catégorie globale porte déjà ce nom à cet endroit');
  throw e;
};

// Catégories globales (SPEC §13.3) : créées, renommées, archivées par l'administrateur, jamais supprimées
// (des transactions de n'importe quel utilisateur peuvent les référencer). Chaque écriture est journalisée.
@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Category[]> {
    return this.prisma.category.findMany({ where: GLOBAL, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  // Globale non technique ; une catégorie perso est indiscernable d'une absente (404).
  private async editable(id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({ where: { id, ...GLOBAL } });
    if (!category) throw new NotFoundException();
    if (TECHNICAL_CATEGORY_KEYS.includes(category.nameKey ?? '')) throw new UnprocessableEntityException('Catégorie technique non modifiable');
    return category;
  }

  // ponytail: doublon vérifié sur `name` seulement ; les libellés du seed sont traduits côté front, qui les compare avant envoi.
  async create(adminId: string, { name, parentId, color }: CreateCategoryDto): Promise<Category> {
    if (parentId) {
      const parent = await this.editable(parentId);
      if (parent.parentId) throw new UnprocessableEntityException('2 niveaux de catégories maximum');
      if (parent.archivedAt) throw new UnprocessableEntityException('Catégorie archivée');
    }
    return this.prisma
      .$transaction(async (tx) => {
        const category = await tx.category.create({ data: { name, parentId, color } });
        await tx.adminAuditLog.create({ data: { adminId, action: 'CATEGORY_CREATED', targetId: category.id } });
        return category;
      })
      .catch(duplicate);
  }

  // Archiver ne touche ni aux transactions ni aux modèles de récurrence : seules les listes de saisie l'excluent.
  async update(adminId: string, id: string, { name, color, archived }: AdminUpdateCategoryDto): Promise<Category> {
    const current = await this.editable(id);
    const data: Prisma.CategoryUpdateInput = { name, color };
    const actions: string[] = [];
    if (name !== undefined || color !== undefined) actions.push('CATEGORY_UPDATED');
    if (archived !== undefined && archived !== (current.archivedAt !== null)) {
      data.archivedAt = archived ? new Date() : null;
      actions.push(archived ? 'CATEGORY_ARCHIVED' : 'CATEGORY_RESTORED');
    }
    return this.prisma
      .$transaction(async (tx) => {
        const category = await tx.category.update({ where: { id }, data });
        await tx.adminAuditLog.createMany({ data: actions.map((action) => ({ adminId, action, targetId: id })) });
        return category;
      })
      .catch(duplicate);
  }
}
