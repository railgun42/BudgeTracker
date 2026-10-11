import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE, csrfCookie } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Double-submit : toute méthode non sûre doit renvoyer le cookie CSRF dans l'en-tête X-CSRF-Token.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const cookie = Buffer.from(String(req.cookies?.[CSRF_COOKIE] ?? ''));
    const header = Buffer.from(req.get('x-csrf-token') ?? '');
    if (cookie.length > 0 && cookie.length === header.length && timingSafeEqual(cookie, header)) return true;
    throw new ForbiddenException('Jeton CSRF manquant ou invalide');
  }
}

// Pose le cookie CSRF au premier passage (ex. GET /api/v1/me au chargement du front).
export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.[CSRF_COOKIE]) res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), csrfCookie);
  next();
}
