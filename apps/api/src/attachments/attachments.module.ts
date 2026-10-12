import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({ imports: [StorageModule, TransactionsModule], controllers: [AttachmentsController], providers: [AttachmentsService] })
export class AttachmentsModule {}
