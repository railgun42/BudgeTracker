import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from './cookies';

export interface AuthUser {
  id: string;
}

type AuthRequest = Request & { user?: AuthUser };

// Jeton d'accès lu uniquement dans le cookie httpOnly (jamais d'en-tête Authorization).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException();
    const sub = await this.jwt.verifyAsync<{ sub: string }>(token).then(
      (payload) => payload.sub,
      () => null,
    );
    // Compte supprimé (RGPD) : son jeton d'accès, encore signé valide, ne sert plus à rien.
    if (!sub || !(await this.prisma.user.count({ where: { id: sub } }))) throw new UnauthorizedException();
    req.user = { id: sub };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>().user!,
);
