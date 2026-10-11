import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { CsrfGuard } from './common/csrf.guard';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TagsModule } from './tags/tags.module';
import { UsersController } from './users/users.controller';

@Module({
  imports: [PrismaModule, AuthModule, AccountsModule, CategoriesModule, TagsModule],
  controllers: [HealthController, UsersController],
  // CSRF global : toute nouvelle route non sûre est protégée par défaut.
  providers: [{ provide: APP_GUARD, useClass: CsrfGuard }],
})
export class AppModule {}
