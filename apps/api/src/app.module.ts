import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountsModule } from './accounts/accounts.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { BalanceModule } from './balance/balance.module';
import { CategoriesModule } from './categories/categories.module';
import { CsrfGuard } from './common/csrf.guard';
import { GdprController } from './gdpr/gdpr.controller';
import { GdprService } from './gdpr/gdpr.service';
import { HealthController } from './health/health.controller';
import { InterestModule } from './interest/interest.module';
import { InterestJob } from './jobs/interest.job';
import { PurgeJob } from './jobs/purge.job';
import { RecurrenceJob } from './jobs/recurrence.job';
import { PrismaModule } from './prisma/prisma.module';
import { RecurrencesModule } from './recurrences/recurrences.module';
import { ScenariosController } from './scenarios/scenarios.controller';
import { ScenariosService } from './scenarios/scenarios.service';
import { CashflowSimulationsController } from './simulations/cashflow-simulations.controller';
import { CashflowSimulationsService } from './simulations/cashflow-simulations.service';
import { SimulationsController } from './simulations/simulations.controller';
import { SimulationsService } from './simulations/simulations.service';
import { StatsModule } from './stats/stats.module';
import { StorageModule } from './storage/storage.module';
import { TagsModule } from './tags/tags.module';
import { TransactionsModule } from './transactions/transactions.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersController } from './users/users.controller';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AuthModule, AccountsModule, BalanceModule, CategoriesModule, TagsModule, TransactionsModule, TransfersModule, RecurrencesModule, InterestModule, StorageModule, AttachmentsModule, StatsModule],
  controllers: [HealthController, AdminController, UsersController, SimulationsController, CashflowSimulationsController, ScenariosController, GdprController],
  // CSRF global : toute nouvelle route non sûre est protégée par défaut.
  providers: [{ provide: APP_GUARD, useClass: CsrfGuard }, AdminService, PurgeJob, RecurrenceJob, InterestJob, SimulationsService, CashflowSimulationsService, ScenariosService, GdprService],
})
export class AppModule {}
