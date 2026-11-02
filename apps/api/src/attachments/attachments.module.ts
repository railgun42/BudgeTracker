import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { DocumentsController } from './documents.controller';

@Module({ imports: [StorageModule, TransactionsModule], controllers: [AttachmentsController, DocumentsController], providers: [AttachmentsService] })
export class AttachmentsModule {}
