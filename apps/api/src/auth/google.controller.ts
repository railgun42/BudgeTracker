import { Controller, ForbiddenException, Get, HttpException, Logger, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { OAUTH_COOKIE, oauthCookie } from '../common/cookies';
import { setSession } from './auth.controller';
import { appUrl, AuthService, randomToken } from './auth.service';
import { GoogleService } from './google.service';

// Flux « authorization code » : navigation pleine page, la réponse est toujours une redirection vers le front.
@Controller('v1/auth/google')
@UseGuards(ThrottlerGuard)
export class GoogleController {
  private readonly logger = new Logger(GoogleController.name);

  constructor(
    private readonly google: GoogleService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  start(@Res() res: Response): void {
    const [state, verifier] = [randomToken(), randomToken()];
    const url = this.google.authorizationUrl(state, verifier);
    res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, oauthCookie).redirect(url);
  }

  // Le state (lié au navigateur par cookie) empêche le login CSRF ; le cookie ne sert qu'une fois.
  @Get('callback')
  async callback(@Query('code') code: unknown, @Query('state') state: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const [expected, verifier] = String(req.cookies?.[OAUTH_COOKIE] ?? '').split('.');
    res.clearCookie(OAUTH_COOKIE, oauthCookie);
    try {
      if (!expected || !verifier || typeof code !== 'string' || state !== expected) throw new UnauthorizedException('state invalide');
      const userId = await this.google.resolveUser(await this.google.exchangeCode(code, verifier));
      setSession(res, (await this.auth.openSession(userId)).session);
      res.redirect(`${appUrl()}/`);
    } catch (e) {
      if (!(e instanceof HttpException)) this.logger.error(e instanceof Error ? e.message : String(e));
      // Forbidden = liaison refusée (e-mail non vérifié) : le front peut l'expliquer.
      res.redirect(`${appUrl()}/login?error=${e instanceof ForbiddenException ? 'google_link_refused' : 'google'}`);
    }
  }
}
