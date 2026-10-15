import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CreateCategoryInput, TECHNICAL_CATEGORY_KEYS } from '@budgetracker/shared';
import { Category, Prisma } from '../generated/prisma/client';
import { AdminUpdateCategoryDto } from '../categories/categories.dto';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL = { userId: null };

// P2002 : index unique (parentId, lower(name)) des globales (migration global_categories).
const duplicate = (e: { code?: string }): never => {
  if (e.code === 'P2002') throw new ConflictException('Une catégorie globale porte déjà ce nom à cet endroit');
  throw e;
};

// P2003 : clé étrangère (transaction, modèle de récurrence ou sous-catégorie de n'importe quel utilisateur).
const inUse = (e: { code?: string }): never => {
  if (e.code === 'P2003') throw new ConflictException('Catégorie utilisée : l’archiver plutôt');
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
  private async editable(id: string, db: Prisma.TransactionClient = this.prisma): Promise<Category> {
    const category = await db.category.findFirst({ where: { id, ...GLOBAL } });
    if (!category) throw new NotFoundException();
    if (TECHNICAL_CATEGORY_KEYS.includes(category.nameKey ?? '')) throw new UnprocessableEntityException('Catégorie technique non modifiable');
    return category;
  }

  // ponytail: doublon vérifié sur `name` seulement ; les libellés du seed sont traduits côté front, qui les compare avant envoi.
  create(adminId: string, dto: CreateCategoryInput): Promise<Category> {
    return this.prisma.$transaction((tx) => this.createIn(tx, adminId, dto));
  }

  // Parent d'une globale : racine globale non technique ni archivée.
  private async checkParent(tx: Prisma.TransactionClient, parentId: string): Promise<void> {
    const parent = await this.editable(parentId, tx);
    if (parent.parentId) throw new UnprocessableEntityException('2 niveaux de catégories maximum');
    if (parent.archivedAt) throw new UnprocessableEntityException('Catégorie archivée');
  }

  // Dans la transaction de l'appelant : sert aussi à accepter une suggestion (admin/suggestions.service.ts).
  async createIn(tx: Prisma.TransactionClient, adminId: string, { name, parentId, color, hiddenForUsersBefore }: CreateCategoryInput & { hiddenForUsersBefore?: Date }): Promise<Category> {
    if (parentId) await this.checkParent(tx, parentId);
    const category = await tx.category.create({ data: { name, parentId, color, hiddenForUsersBefore } }).catch(duplicate);
    await tx.adminAuditLog.create({ data: { adminId, action: 'CATEGORY_CREATED', targetId: category.id } });
    return category;
  }

  // Catégorie perso promue globale (suggestion acceptée, E41) : mêmes règles qu'une création, même identifiant,
  // donc les transactions et récurrences de l'auteur la gardent.
  async promoteIn(tx: Prisma.TransactionClient, adminId: string, { id, parentId }: Category, name: string, hiddenForUsersBefore: Date): Promise<Category> {
    if (parentId) await this.checkParent(tx, parentId);
    const category = await tx.category.update({ where: { id }, data: { userId: null, name, hiddenForUsersBefore } }).catch(duplicate);
    await tx.adminAuditLog.create({ data: { adminId, action: 'CATEGORY_CREATED', targetId: id } });
    return category;
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

  // Suppression définitive d'une globale inutilisée créée par l'admin ; utilisée ⇒ 409 (l'archiver). Contraintes rendues
  // immédiates : toute référence, supprimée logiquement comprise, fait échouer le DELETE lui-même, sans fenêtre de course.
  // Catégorie du seed ⇒ 422 : le seed (upsert par nameKey) la recréerait. Préférences supprimées en cascade ;
  // suggestions traitées gardées sans parent, en attente ⇒ 409.
  async remove(adminId: string, id: string): Promise<void> {
    const category = await this.editable(id);
    if (category.nameKey) throw new UnprocessableEntityException('Catégorie de base : l’archiver');
    await this.prisma.$transaction(async (tx) => {
      if (await tx.categorySuggestion.count({ where: { parentId: id, status: 'PENDING' } })) throw new ConflictException('Suggestions en attente sous cette catégorie');
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      await tx.category.delete({ where: { id } }).catch(inUse);
      await tx.adminAuditLog.create({ data: { adminId, action: 'CATEGORY_DELETED', targetId: id } });
    });
  }
}
