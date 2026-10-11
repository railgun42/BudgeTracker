import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TagDto } from '@budgetracker/shared';
import { Tag } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const toTagDto = ({ id, name }: Tag): TagDto => ({ id, name });

// P2002 : index unique (userId, lower(name)) ; P2025 : tag absent ou d'un autre utilisateur.
const mapError = (e: { code?: string }): never => {
  if (e.code === 'P2002') throw new ConflictException('Ce tag existe déjà');
  if (e.code === 'P2025') throw new NotFoundException();
  throw e;
};

// Pas de deletedAt sur Tag : suppression physique, les liens aux transactions partent en cascade.
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({ where: { userId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  create(userId: string, name: string): Promise<Tag> {
    return this.prisma.tag.create({ data: { userId, name } }).catch(mapError);
  }

  update(userId: string, id: string, name: string): Promise<Tag> {
    return this.prisma.tag.update({ where: { id, userId }, data: { name } }).catch(mapError);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.tag.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
  }
}
