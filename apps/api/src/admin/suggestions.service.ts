import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CategorySuggestionStatus } from '@budgetracker/shared';
import { CategorySuggestion } from '../generated/prisma/client';
import { ResolveCategorySuggestionDto } from '../categories/categories.dto';
import { notifyUser } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCategoriesService } from './categories.service';

// Suggestions de catégorie (SPEC §13.5) côté administrateur : lues sans auteur ni e-mail ; la réponse est
// adressée à l'auteur par une notification personnelle sans que l'administrateur le connaisse.
@Injectable()
export class AdminSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: AdminCategoriesService,
  ) {}

  // En attente d'abord (ordre de l'enum), puis les plus récentes.
  // ponytail: 500 lignes max, sans pagination ; 20 en attente au plus par utilisateur.
  list(status?: CategorySuggestionStatus): Promise<CategorySuggestion[]> {
    return this.prisma.categorySuggestion.findMany({ where: { status }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }], take: 500 });
  }

  // Tout ou rien : décision, catégorie globale (si acceptée), journal et notification. La suggestion est réservée
  // d'abord (PENDING ⇒ décision) : une décision concurrente ou rejouée attend le verrou de ligne puis reçoit 409.
  // Catégorie globale en doublon ou parent archivé ⇒ 409/422 et la suggestion reste en attente.
  resolve(adminId: string, id: string, { decision, reply }: ResolveCategorySuggestionDto): Promise<CategorySuggestion> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.categorySuggestion.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision, treatedAt: new Date() } });
      const suggestion = await tx.categorySuggestion.findUnique({ where: { id } });
      if (!suggestion) throw new NotFoundException();
      if (!count) throw new ConflictException('Suggestion déjà traitée');
      if (decision === 'ACCEPTED') await this.categories.createIn(tx, adminId, { name: suggestion.name, parentId: suggestion.parentId });
      await tx.adminAuditLog.create({ data: { adminId, action: `CATEGORY_SUGGESTION_${decision}`, targetId: id } });
      if (reply) await notifyUser(tx, adminId, suggestion.userId, reply);
      return suggestion;
    });
  }
}
