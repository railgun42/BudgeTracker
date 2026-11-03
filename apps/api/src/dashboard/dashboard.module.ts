import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { RecurrencesModule } from '../recurrences/recurrences.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [AccountsModule, RecurrencesModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
