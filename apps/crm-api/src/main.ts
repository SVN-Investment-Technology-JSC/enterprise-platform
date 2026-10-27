import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { CrmApiModule } from './app/crm-api.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create(CrmApiModule);
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/crm';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3344);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
