import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurrencesService, todayUtc } from '../recurrences/recurrences.service';

// Génération quotidienne des occurrences dues (SPEC §3.6), complétée par le rattrapage à la connexion.
@Injectable()
export class RecurrenceJob {
  private readonly logger = new Logger(RecurrenceJob.name);

  constructor(private readonly recurrences: RecurrencesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron() {
    const created = await this.recurrences.generateAll(todayUtc());
    this.logger.log(`Récurrences : ${created} occurrence(s) créée(s)`);
  }
}
