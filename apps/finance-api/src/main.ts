import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { FinanceApiModule } from './app/finance-api.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create(FinanceApiModule);
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/finance';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3341);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
