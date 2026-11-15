import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Đường dẫn trả dữ liệu riêng của người đang đăng nhập, không được để trình duyệt,
 * proxy hay CDN lưu lại (ISS-OPS-005):
 * - mọi API phiên `/api/auth/...` (đăng nhập, làm mới, `me`), trừ khoá công khai JWKS;
 * - API realtime `/api/realtime/...` (thông báo, đồng bộ, tóm tắt, tuỳ chọn của người dùng);
 * - mọi đoạn đường dẫn `me`, `my`, `my-*` (`/me`, `/me/inbox`, `/my-profile`,
 *   `/my-payslips`, `/request-quota/me`...) và `notifications` của mọi phân hệ.
 */
export function isPersonalDataPath(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (/^\/api\/auth\//.test(clean)) return clean !== '/api/auth/v1/jwks';
  if (/^\/api\/realtime\//.test(clean)) return true;
  return clean
    .split('/')
    .some(
      (segment) =>
        segment === 'me' ||
        segment === 'my' ||
        segment.startsWith('my-') ||
        segment === 'notifications',
    );
}

/** Middleware Express đặt `Cache-Control: no-store` cho đường dẫn dữ liệu cá nhân. */
export function noStorePersonalData(request: Request, response: Response, next: NextFunction): void {
  if (isPersonalDataPath(request.originalUrl ?? request.url)) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }
  next();
}

/**
 * Cấu hình header bảo mật dùng chung cho mọi API Nest (Express). Gọi ngay sau
 * `NestFactory.create` trong `main.ts`:
 * - tắt `X-Powered-By` để không lộ nền tảng máy chủ;
 * - đặt `Cache-Control: no-store` cho dữ liệu cá nhân (xem `isPersonalDataPath`).
 */
export function configureHttpSecurity(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance() as { disable?: (setting: string) => unknown };
  instance.disable?.('x-powered-by');
  app.use(noStorePersonalData);
}
