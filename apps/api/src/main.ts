import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RedactingLogger } from './common/redacting-logger';
import { loadEnv } from './config/env';

// Partagé entre le démarrage réel et les tests e2e.
export function configureApp(app: INestApplication): INestApplication {
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}

export async function bootstrap(env: NodeJS.ProcessEnv = process.env): Promise<INestApplication> {
  const { PORT } = loadEnv(env);
  const app = configureApp(await NestFactory.create(AppModule, { logger: new RedactingLogger() }));
  await app.listen(PORT);
  return app;
}

if (require.main === module) {
  bootstrap().catch((err) => {
    new RedactingLogger().fatal(err instanceof Error ? err.message : String(err), 'Bootstrap');
    process.exit(1);
  });
}
