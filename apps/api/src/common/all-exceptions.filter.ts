import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

// Erreurs serveur (5xx) depuis le démarrage, pour GET /admin/stats (en mémoire, SPEC §13.2).
let serverErrors = 0;
export const serverErrorCount = () => serverErrors;

// Format d'erreur unique ; une erreur inattendue est journalisée et jamais renvoyée au client.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (status >= 500) serverErrors++;
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    serverErrors++;
    this.logger.error(exception instanceof Error ? exception.message : String(exception), exception instanceof Error ? exception.stack : undefined);
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
