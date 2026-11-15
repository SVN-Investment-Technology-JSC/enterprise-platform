/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@enterprise-platform/platform-module-access';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create(AppModule);
  configureHttpSecurity(app);
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/maintenance';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3335);
  await app.listen(port);
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
