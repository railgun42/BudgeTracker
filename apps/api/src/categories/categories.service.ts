import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CategoryDto } from '@budgetracker/shared';
import { Category, UserCategoryPreference } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryPreferenceDto, CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

// `preferences` : celles de l'utilisateur courant seulement (0 ou 1 ligne).
type WithPreferences = Category & { preferences?: UserCategoryPreference[] };

export const toCategoryDto = ({ preferences: [pref] = [], ...c }: WithPreferences): CategoryDto => ({
  id: c.id,
  parentId: c.parentId,
  system: c.userId === null,
  nameKey: c.nameKey,
  name: c.name,
  color: c.color,
  hidden: pref?.hidden ?? false,
  customName: pref?.customName ?? null,
  archived: c.archivedAt !== null,
});

// Visibles : catégories système (userId NULL) + catégories perso de l'utilisateur.
// Celle d'un autre utilisateur est indiscernable d'une catégorie absente (404).
const visibleTo = (userId: string) => ({ OR: [{ userId: null }, { userId }] });

// Pas de deletedAt ni de version sur Category (PLAN §3) : suppression physique, après réaffectation.
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // Masquées comprises : l'historique et les stats en affichent encore le nom ; seules les listes de saisie les excluent (front).
  list(userId: string): Promise<WithPreferences[]> {
    return this.prisma.category.findMany({
      where: visibleTo(userId),
      include: { preferences: { where: { userId } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async visible(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({ where: { id, ...visibleTo(userId) } });
    if (!category) throw new NotFoundException();
    return category;
  }

  // Catégorie système : lecture seule.
  private async own(userId: string, id: string): Promise<Category> {
    const category = await this.visible(userId, id);
    if (category.userId === null) throw new ForbiddenException('Catégorie système non modifiable');
    return category;
  }

  // 2 niveaux max : le parent doit être une racine. Rien de nouveau sous une globale archivée (E38).
  // ponytail: vérifié en service sans verrou ; deux reparentages simultanés croisés peuvent créer un 3e niveau (trigger SQL si besoin).
  private async checkParent(userId: string, parentId: string): Promise<void> {
    const parent = await this.visible(userId, parentId);
    if (parent.parentId) throw new UnprocessableEntityException('2 niveaux de catégories maximum');
    if (parent.archivedAt) throw new UnprocessableEntityException('Catégorie archivée');
  }

  private async hasChildren(userId: string, id: string): Promise<boolean> {
    return (await this.prisma.category.count({ where: { parentId: id, userId } })) > 0;
  }

  async create(userId: string, { name, parentId, color }: CreateCategoryDto): Promise<Category> {
    if (parentId) await this.checkParent(userId, parentId);
    return this.prisma.category.create({ data: { userId, name, parentId, color } });
  }

  async update(userId: string, id: string, { name, parentId, color }: UpdateCategoryDto): Promise<Category> {
    await this.own(userId, id);
    if (parentId) {
      if (parentId === id) throw new UnprocessableEntityException('Une catégorie ne peut pas être son propre parent');
      await this.checkParent(userId, parentId);
      if (await this.hasChildren(userId, id)) throw new UnprocessableEntityException('2 niveaux de catégories maximum');
    }
    return this.prisma.category.update({ where: { id, userId }, data: { name, parentId, color } });
  }

  // Masquer / renommer une catégorie système pour soi seul ; les valeurs par défaut suppriment la ligne.
  async setPreference(userId: string, categoryId: string, { hidden, customName = null }: CategoryPreferenceDto): Promise<WithPreferences> {
    const category = await this.visible(userId, categoryId);
    if (category.userId !== null) throw new UnprocessableEntityException('Catégorie personnelle : la modifier directement');
    const key = { userId_categoryId: { userId, categoryId } };
    if (!hidden && customName === null) {
      await this.prisma.userCategoryPreference.deleteMany({ where: { userId, categoryId } });
      return category;
    }
    const pref = await this.prisma.userCategoryPreference.upsert({ where: key, create: { userId, categoryId, hidden, customName }, update: { hidden, customName } });
    return { ...category, preferences: [pref] };
  }

  // Catégorie utilisée : réaffectation obligatoire vers `reassignTo` (système ou perso visible), sinon 409.
  // Les transactions supprimées logiquement comptent aussi : la clé étrangère les référence encore.
  // ponytail: une transaction créée entre le comptage et le COMMIT fait échouer la clé étrangère différée (500) ; la mapper en 409 si ça arrive.
  async remove(userId: string, id: string, reassignTo?: string): Promise<void> {
    await this.own(userId, id);
    if (await this.hasChildren(userId, id)) throw new ConflictException('Supprimer ou déplacer d’abord les sous-catégories');
    if (reassignTo) {
      if (reassignTo === id) throw new UnprocessableEntityException('La cible doit être une autre catégorie');
      await this.visible(userId, reassignTo);
    }
    const transactions = { categoryId: id, userId };
    const templates = { categoryId: id, recurrence: { userId } };
    await this.prisma.$transaction(async (tx) => {
      if (reassignTo) {
        await tx.transaction.updateMany({ where: transactions, data: { categoryId: reassignTo } });
        await tx.transactionTemplate.updateMany({ where: templates, data: { categoryId: reassignTo } });
      } else if ((await tx.transaction.count({ where: transactions })) + (await tx.transactionTemplate.count({ where: templates })) > 0) {
        throw new ConflictException('Catégorie utilisée : préciser reassignTo');
      }
      await tx.category.delete({ where: { id, userId } });
    });
  }
}
