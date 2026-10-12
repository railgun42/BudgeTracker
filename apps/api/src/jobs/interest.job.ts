import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InterestService } from '../interest/interest.service';
import { todayUtc } from '../recurrences/recurrences.service';

// Crédit d'intérêts du 31/12 (SPEC §3.5) : quotidien, il crédite au 1er janvier l'année close (solde du 31/12
// connu en entier), daté du 31/12, et rattrape toute année manquée (serveur arrêté, taux saisi en retard).
@Injectable()
export class InterestJob {
  private readonly logger = new Logger(InterestJob.name);

  constructor(private readonly interest: InterestService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron() {
    const created = await this.interest.creditAll(todayUtc());
    this.logger.log(`Intérêts : ${created} crédit(s) créé(s)`);
  }
}
