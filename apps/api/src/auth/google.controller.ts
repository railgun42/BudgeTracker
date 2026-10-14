import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  PreconditionFailedException,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { OAUTH_COOKIE, oauthCookie, TERMS_COOKIE } from '../common/cookies';
import { setSession } from './auth.controller';
import { appUrl, AuthService, randomToken, TERMS_VERSION } from './auth.service';
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

  // `?terms=accepted` : envoyé par la page d'inscription quand la case CGU est cochée (E29c).
  @Get()
  start(@Query('terms') terms: unknown, @Res() res: Response): void {
    const [state, verifier] = [randomToken(), randomToken()];
    const url = this.google.authorizationUrl(state, verifier);
    if (terms === 'accepted') res.cookie(TERMS_COOKIE, TERMS_VERSION, oauthCookie);
    else res.clearCookie(TERMS_COOKIE, oauthCookie);
    res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, oauthCookie).redirect(url);
  }

  // Le state (lié au navigateur par cookie) empêche le login CSRF ; le cookie ne sert qu'une fois.
  @Get('callback')
  async callback(@Query('code') code: unknown, @Query('state') state: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const [expected, verifier] = String(req.cookies?.[OAUTH_COOKIE] ?? '').split('.');
    const termsAccepted = req.cookies?.[TERMS_COOKIE] === TERMS_VERSION;
    res.clearCookie(OAUTH_COOKIE, oauthCookie).clearCookie(TERMS_COOKIE, oauthCookie);
    try {
      if (!expected || !verifier || typeof code !== 'string' || state !== expected) throw new UnauthorizedException('state invalide');
      const userId = await this.google.resolveUser(await this.google.exchangeCode(code, verifier), termsAccepted);
      setSession(res, (await this.auth.openSession(userId)).session);
      res.redirect(`${appUrl()}/`);
    } catch (e) {
      if (!(e instanceof HttpException)) this.logger.error(e instanceof Error ? e.message : String(e));
      // Forbidden = liaison refusée (e-mail non vérifié), PreconditionFailed = nouveau compte sans consentement CGU.
      const error =
        e instanceof ForbiddenException ? 'google_link_refused' : e instanceof PreconditionFailedException ? 'google_terms' : 'google';
      res.redirect(`${appUrl()}/login?error=${error}`);
    }
  }
}
