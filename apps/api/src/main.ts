/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Tài liệu icon của Brand Studio (PUT /api/platform/v1/brand/icons) có thể lớn hơn mức mặc định 100 KB;
  // máy chủ vẫn tự giới hạn tài liệu sau khi chuẩn hoá (BRAND_SPEC_MAX_BYTES).
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port);
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
