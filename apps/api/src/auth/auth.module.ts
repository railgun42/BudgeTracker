import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ACCESS_TTL_MS } from '../common/cookies';
import { MailService } from '../mail/mail.service';
import { RecurrencesModule } from '../recurrences/recurrences.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    // Global : JwtAuthGuard est utilisable par tous les modules.
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TTL_MS / 1000 },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // Par IP (req.ip, cf. trust proxy) sur les routes marquées ThrottlerGuard : 5 essais / minute.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    RecurrencesModule,
  ],
  controllers: [AuthController, GoogleController],
  providers: [AuthService, MailService, PasswordResetService, GoogleService],
})
export class AuthModule {}
