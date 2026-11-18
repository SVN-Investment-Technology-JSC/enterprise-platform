import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { PushController } from './push.controller.js';

jest.mock('@enterprise-platform/platform-identity', () => ({
  TenantCoreAccess: class TenantCoreAccess {},
}));

describe('PushController (FCM mobile devices & status)', () => {
  const principal: TenantUserPrincipal = {
    kind: 'tenant-user',
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    email: 'nv@savina.com',
    displayName: 'Nhân viên',
    roles: ['employee'],
    permissions: [],
    tenantId: '33333333-3333-4333-8333-333333333333',
    tenantSlug: 'savina',
    membershipId: '11111111-1111-4111-8111-111111111111',
  };

  function setup() {
    const db = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ relation: 'core_schema.fcm_device_tokens' }] };
        if (sql.includes('count(*)')) return { rows: [{ total: 2 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const access = {
      principal: jest.fn().mockResolvedValue(principal),
      requireCsrf: jest.fn((req: Request) => {
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ') && auth.slice(7).trim()) return;
        if (!req.headers['x-csrf-token'] || req.headers['x-csrf-token'] !== req.cookies?.ep_csrf) {
          throw new ForbiddenException('Thiếu mã chống giả mạo yêu cầu.');
        }
      }),
      pool: jest.fn().mockResolvedValue(db),
      transaction: jest.fn(async (_tenantId: string, work: (client: unknown) => Promise<unknown>) => work(db)),
    };
    return { controller: new PushController(access as never), db, access };
  }

  it('cho phép Mobile đăng ký thiết bị bằng Authorization: Bearer mà không cần cookie CSRF', async () => {
    const { controller, db } = setup();
    const req = {
      headers: { authorization: 'Bearer valid-jwt-token' },
      cookies: {},
      get: () => 'Flutter/3.24 (Android)',
    } as unknown as Request;

    await expect(
      controller.registerDevice(req, {
        token: 'fK7d91bHun2x0_abc-DEF:APA91bHun2x0',
        platform: 'android',
        deviceId: 'pixel-8',
      }),
    ).resolves.toBeUndefined();

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO core_schema.fcm_device_tokens'),
      [
        principal.userId,
        principal.sessionId,
        'fK7d91bHun2x0_abc-DEF:APA91bHun2x0',
        'android',
        'pixel-8',
        'Flutter/3.24 (Android)',
      ],
    );
  });

  it('vẫn bắt buộc CSRF khi gọi bằng cookie trình duyệt không có Bearer header', async () => {
    const { controller } = setup();
    const reqWithoutCsrf = {
      headers: {},
      cookies: { ep_access: 'cookie-jwt' },
      get: () => 'Mozilla/5.0',
    } as unknown as Request;

    await expect(
      controller.registerDevice(reqWithoutCsrf, {
        token: 'fK7d91bHun2x0_abc-DEF:APA91bHun2x0',
        platform: 'ios',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('từ chối nền tảng lạ hoặc token sai định dạng', async () => {
    const { controller } = setup();
    const req = {
      headers: { authorization: 'Bearer valid-jwt-token' },
      cookies: {},
      get: () => undefined,
    } as unknown as Request;

    await expect(
      controller.registerDevice(req, { token: 'short', platform: 'android' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.registerDevice(req, {
        token: 'fK7d91bHun2x0_abc-DEF:APA91bHun2x0',
        platform: 'windows' as 'android',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('xoá thiết bị theo phiên hiện tại khi đăng xuất không truyền body và trả đúng trạng thái status', async () => {
    const { controller, db } = setup();
    const req = {
      headers: { authorization: 'Bearer valid-jwt-token' },
      cookies: {},
      get: () => undefined,
    } as unknown as Request;

    await controller.removeDevice(req, {});
    expect(db.query).toHaveBeenCalledWith(
      'DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND session_id = $2',
      [principal.userId, principal.sessionId],
    );

    const status = await controller.status(req);
    expect(status).toEqual({ enabled: false, tokens: 2 });
  });
});
