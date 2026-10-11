import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ACCESS_COOKIE } from './cookies';

export interface AuthUser {
  id: string;
}

type AuthRequest = Request & { user?: AuthUser };

// Jeton d'accès lu uniquement dans le cookie httpOnly (jamais d'en-tête Authorization).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      req.user = { id: sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>().user!,
);
