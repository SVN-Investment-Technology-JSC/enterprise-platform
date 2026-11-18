import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { CorrespondenceApiModule } from './app/correspondence-api.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create(CorrespondenceApiModule);
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/correspondence';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3345);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
