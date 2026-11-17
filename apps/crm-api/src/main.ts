import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { CrmApiModule } from './app/crm-api.module';
import { configureCrmBodyParsers } from './app/crm-body-parsers';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  // Parser thân request tự cấu hình: route lưu bố cục mẫu báo giá nhận tới 2 MB, các route khác giữ 100 KB.
  const app = await NestFactory.create<NestExpressApplication>(CrmApiModule, { bodyParser: false });
  app.use(cookieParser());
  configureCrmBodyParsers(app);
  app.enableShutdownHooks();
  const globalPrefix = 'api/crm';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3344);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
