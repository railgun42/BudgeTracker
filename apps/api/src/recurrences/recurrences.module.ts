import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { RecurrencesController } from './recurrences.controller';
import { RecurrencesService } from './recurrences.service';

@Module({ imports: [TransactionsModule], controllers: [RecurrencesController], providers: [RecurrencesService], exports: [RecurrencesService] })
export class RecurrencesModule {}
