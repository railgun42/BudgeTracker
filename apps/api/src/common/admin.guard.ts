import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './jwt-auth.guard';

// Routes /admin/* (SPEC §13.1) : toujours après JwtAuthGuard ⇒ 401 sans session, 403 sans rôle ADMIN.
// Rôle relu en base à chaque requête : un retrait de rôle est immédiat, jamais porté par le jeton.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!user || !(await this.prisma.user.count({ where: { id: user.id, role: 'ADMIN' } }))) throw new ForbiddenException();
    return true;
  }
}
