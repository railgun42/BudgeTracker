import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UserDto } from '@budgetracker/shared';
import { Request, Response } from 'express';
import { ACCESS_COOKIE, accessCookie, REFRESH_COOKIE, refreshCookie } from '../common/cookies';
import { toUserDto } from '../users/users.controller';
import { LoginDto, SignupDto, VerifyEmailDto } from './auth.dto';
import { AuthService, Session } from './auth.service';

// Les jetons ne transitent que par cookies httpOnly, jamais dans le corps des réponses.
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  signup(@Body() dto: SignupDto): Promise<void> {
    return this.auth.signup(dto);
  }

  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(@Body() { token }: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(token);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<UserDto> {
    const { user, session } = await this.auth.login(dto);
    setSession(res, session);
    return toUserDto(user);
  }

  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      setSession(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (e) {
      clearSession(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSession(res);
  }
}

function setSession(res: Response, { access, refresh }: Session): void {
  res.cookie(ACCESS_COOKIE, access, accessCookie);
  if (refresh) res.cookie(REFRESH_COOKIE, refresh, refreshCookie);
}

function clearSession(res: Response): void {
  // Express 5 ignore maxAge ici ; le path doit correspondre à celui du cookie posé.
  res.clearCookie(ACCESS_COOKIE, accessCookie).clearCookie(REFRESH_COOKIE, refreshCookie);
}
