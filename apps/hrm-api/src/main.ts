import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { HrmApiModule } from './app/hrm-api.module.js';

async function bootstrap() {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* environment can be injected by runtime */
  }

  const app = await NestFactory.create(HrmApiModule);
  app.use(cookieParser());
  app.enableShutdownHooks();

  const globalPrefix = 'api/hrm';
  app.setGlobalPrefix(globalPrefix);

  const port = Number(process.env.PORT ?? 3337);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

void bootstrap();
