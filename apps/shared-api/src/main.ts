import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { IncomingMessage } from 'node:http';
import { SharedApiModule } from './app/shared-api.module';

const FILE_PROXY_ROUTE = /\/v1\/files\/[^/?#]+$/;

/**
 * Route chuyển tiếp tệp nhận thân yêu cầu là chính tệp (tới 200 MB, kiểu bất kỳ, kể cả
 * `application/json`) và đọc thành luồng ghi thẳng lên kho; parser JSON, form không được
 * đọc trước nó. Các route khác giữ đúng mặc định của Nest.
 */
function bodyOf(pattern: RegExp) {
  return (request: IncomingMessage) =>
    !FILE_PROXY_ROUTE.test((request.url ?? '').split('?')[0]) &&
    pattern.test(String(request.headers['content-type'] ?? '').trim());
}

async function bootstrap() {
  try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
  const app = await NestFactory.create<NestExpressApplication>(SharedApiModule, { bodyParser: false });
  app.useBodyParser('json', { type: bodyOf(/^application\/json\s*(;|$)/i) });
  app.useBodyParser('urlencoded', { extended: true, type: bodyOf(/^application\/x-www-form-urlencoded\s*(;|$)/i) });
  app.use(cookieParser());
  app.enableShutdownHooks();
  const globalPrefix = 'api/shared';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(process.env.PORT ?? 3342);
  const server = await app.listen(port);
  // Tải lên qua máy chủ (kho ngoài chế độ proxy) có thể lâu hơn 5 phút mặc định của Node.
  server.requestTimeout = 60 * 60 * 1000;
  Logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
