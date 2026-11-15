import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@enterprise-platform/platform-module-access';
import cookieParser from 'cookie-parser';
import { SocialApiModule } from './app/social-api.module';

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create(SocialApiModule);
  configureHttpSecurity(app);
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/social';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3343);
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
