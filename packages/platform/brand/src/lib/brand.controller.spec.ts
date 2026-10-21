import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
} from '@enterprise-platform/shared-brand-icon';
import {
  BRAND_AUTHENTICATOR,
  BrandController,
  type BrandAuthenticator,
} from './brand.controller.js';
import { BrandIconService } from './brand-icon.service.js';
import { FakeBrandStore, FakeObjectStore } from './testing/brand-fakes.js';
import { sampleDocument } from './testing/sample-documents.js';

const admin: AuthenticatedPrincipal = {
  kind: 'platform-admin',
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-0000000000aa',
  email: 'admin@platform.local',
  displayName: 'Admin',
  roles: ['platform-admin'],
  permissions: [],
};
const tenantUser: AuthenticatedPrincipal = {
  kind: 'tenant-user',
  userId: '00000000-0000-4000-8000-000000000002',
  sessionId: '00000000-0000-4000-8000-0000000000bb',
  email: 'user@tenant.local',
  displayName: 'User',
  roles: ['tenant-admin'],
  permissions: ['tenant.manage'],
  tenantId: 'tenant-1',
  tenantSlug: 'savina',
  membershipId: 'm-1',
};

const authenticator: BrandAuthenticator = {
  verifyAccessToken: async (token) => {
    if (token === 'admin-token') return admin;
    if (token === 'user-token') return tenantUser;
    throw new Error('session expired');
  },
};

const CSRF = 'csrf-123';
const asAdmin = {
  cookie: `ep_access=admin-token; ep_csrf=${CSRF}`,
  'x-csrf-token': CSRF,
};

let app: INestApplication;
let base: string;
let store: FakeBrandStore;
let objects: FakeObjectStore;
let publicRead = true;

beforeAll(async () => {
  Logger.overrideLogger(false);
  store = new FakeBrandStore();
  objects = new FakeObjectStore();
  const service = new BrandIconService(store, objects, {
    publicRead: () => publicRead,
  });
  const module = await Test.createTestingModule({
    controllers: [BrandController],
    providers: [
      { provide: BrandIconService, useValue: service },
      { provide: BRAND_AUTHENTICATOR, useValue: authenticator },
    ],
  }).compile();
  app = module.createNestApplication();
  // Giống cookie-parser trong apps/api/src/main.ts.
  app.use(
    (
      request: {
        headers: { cookie?: string };
        cookies?: Record<string, string>;
      },
      _res: unknown,
      next: () => void,
    ) => {
      request.cookies = Object.fromEntries(
        (request.headers.cookie ?? '')
          .split(';')
          .map((part) => part.trim().split('='))
          .filter(([name]) => name),
      );
      next();
    },
  );
  app.setGlobalPrefix('api');
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform/v1/brand`;
});

afterAll(async () => {
  await app.close();
  Logger.overrideLogger(['log', 'error', 'warn']);
});

async function call(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: json as Record<string, unknown>,
  };
}

describe('xác thực và phân quyền', () => {
  it.each([
    ['GET', '/icons'],
    ['GET', '/icons/icon-a'],
    ['GET', '/icons/icon-a/spec'],
    ['GET', '/standards'],
  ])(
    '%s %s không có phiên: 401 với thân lỗi { statusCode, code, message }',
    async (method, path) => {
      const result = await call(method, path);
      expect(result.status).toBe(401);
      expect(result.json).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
      expect(typeof result.json.message).toBe('string');
    },
  );

  it('token hết hạn hoặc sai: 401; người dùng tenant: 403 FORBIDDEN', async () => {
    expect(
      (
        await call('GET', '/icons', {
          headers: { cookie: 'ep_access=het-han' },
        })
      ).status,
    ).toBe(401);
    const result = await call('GET', '/icons', {
      headers: { cookie: 'ep_access=user-token' },
    });
    expect(result.status).toBe(403);
    expect(result.json).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('nhận cả Bearer token', async () => {
    const result = await call('GET', '/icons', {
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(result.status).toBe(200);
  });

  it.each([
    ['POST', '/icons'],
    ['PUT', '/icons/icon-a'],
    ['POST', '/icons/icon-a/publish'],
    ['POST', '/icons/icon-a/unpublish'],
    ['DELETE', '/icons/icon-a'],
    ['POST', '/icons/icon-a/restore'],
    ['PUT', '/standards'],
  ])(
    '%s %s: người dùng tenant bị 403 và thiếu CSRF cũng bị 403 trước khi chạm DB',
    async (method, path) => {
      const body = { document: sampleDocument(), baseVersion: 1 };
      const before = store.transactions;
      const tenant = await call(method, path, {
        body,
        headers: {
          cookie: `ep_access=user-token; ep_csrf=${CSRF}`,
          'x-csrf-token': CSRF,
        },
      });
      expect(tenant.status).toBe(403);
      expect(tenant.json.code).toBe('FORBIDDEN');
      const noCsrf = await call(method, path, {
        body,
        headers: { cookie: 'ep_access=admin-token' },
      });
      expect([noCsrf.status, noCsrf.json.code]).toEqual([403, 'CSRF_INVALID']);
      const wrongCsrf = await call(method, path, {
        body,
        headers: {
          cookie: 'ep_access=admin-token; ep_csrf=a',
          'x-csrf-token': 'b',
        },
      });
      expect([wrongCsrf.status, wrongCsrf.json.code]).toEqual([
        403,
        'CSRF_INVALID',
      ]);
      const anonymous = await call(method, path, { body });
      expect(anonymous.status).toBe(401);
      expect(store.transactions).toBe(before);
    },
  );
});

describe('luồng quản trị qua HTTP', () => {
  it('tạo, sửa, xung đột, phát hành, đọc tài liệu và lưu trữ', async () => {
    const created = await call('POST', '/icons', {
      headers: asAdmin,
      body: { document: sampleDocument(), note: 'v1' },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      unchanged: false,
      icon: { id: 'icon-a', currentVersion: 1 },
      version: { version: 1 },
    });

    const invalid = await call('POST', '/icons', {
      headers: asAdmin,
      body: { document: { id: 'x' } },
    });
    expect([invalid.status, invalid.json.code]).toEqual([
      400,
      'BRAND_ICON_INVALID',
    ]);
    expect(
      (await call('POST', '/icons', { headers: asAdmin, body: [] })).json.code,
    ).toBe('BRAND_REQUEST_INVALID');
    expect(
      (
        await call('POST', '/icons', {
          headers: asAdmin,
          body: { document: sampleDocument() },
        })
      ).status,
    ).toBe(409);

    const saved = await call('PUT', '/icons/icon-a', {
      headers: asAdmin,
      body: {
        document: { ...sampleDocument(), name: 'Tên mới' },
        baseVersion: 1,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      icon: { name: 'Tên mới', currentVersion: 2 },
    });

    const conflict = await call('PUT', '/icons/icon-a', {
      headers: asAdmin,
      body: {
        document: { ...sampleDocument(), name: 'Người khác' },
        baseVersion: 1,
      },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json).toMatchObject({
      statusCode: 409,
      code: 'BRAND_ICON_VERSION_CONFLICT',
      currentVersion: 2,
    });

    const spec = await call('GET', '/icons/icon-a/spec?version=1', {
      headers: asAdmin,
    });
    expect(spec.status).toBe(200);
    expect(spec.json).toMatchObject({
      version: 1,
      document: { id: 'icon-a', name: 'Biểu tượng A' },
    });
    expect(
      (
        await call('GET', '/icons/icon-a/spec?version=abc', {
          headers: asAdmin,
        })
      ).json.code,
    ).toBe('BRAND_REQUEST_INVALID');
    expect(
      (await call('GET', '/icons/icon-a/spec?version=9', { headers: asAdmin }))
        .status,
    ).toBe(404);

    const published = await call('POST', '/icons/icon-a/publish', {
      headers: asAdmin,
    });
    expect(published.status).toBe(200);
    expect(published.json).toMatchObject({
      status: 'published',
      publishedVersion: 2,
    });

    const list = await call('GET', '/icons?status=published', {
      headers: asAdmin,
    });
    expect((list.json.icons as unknown[]).length).toBe(1);
    expect(
      (await call('GET', '/icons?status=bogus', { headers: asAdmin })).json
        .code,
    ).toBe('BRAND_REQUEST_INVALID');
    const detail = await call('GET', '/icons/icon-a', { headers: asAdmin });
    expect(
      (detail.json.versions as { version: number }[]).map((v) => v.version),
    ).toEqual([2, 1]);

    expect(
      (await call('POST', '/icons/icon-a/unpublish', { headers: asAdmin }))
        .json,
    ).toMatchObject({ status: 'draft' });
    const archived = await call('DELETE', '/icons/icon-a', {
      headers: asAdmin,
    });
    expect(archived.json).toMatchObject({ status: 'archived' });
    expect(
      (await call('POST', '/icons/icon-a/restore', { headers: asAdmin })).json,
    ).toMatchObject({ status: 'draft' });
    expect(
      (await call('GET', '/icons/khong-co', { headers: asAdmin })).status,
    ).toBe(404);
  });

  it('đọc và lưu bảng màu, quy chuẩn', async () => {
    const initial = await call('GET', '/standards', { headers: asAdmin });
    expect(initial.status).toBe(200);
    expect(initial.json).toMatchObject({
      version: 0,
      palette: DEFAULT_PALETTE,
      rules: DEFAULT_RULES,
    });

    const saved = await call('PUT', '/standards', {
      headers: asAdmin,
      body: {
        palette: DEFAULT_PALETTE,
        rules: { ...DEFAULT_RULES, maxShapes: 8 },
        baseVersion: 0,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      version: 1,
      unchanged: false,
      rules: { maxShapes: 8 },
    });
    const stale = await call('PUT', '/standards', {
      headers: asAdmin,
      body: { palette: DEFAULT_PALETTE, rules: DEFAULT_RULES, baseVersion: 0 },
    });
    expect([stale.status, stale.json.code]).toEqual([
      409,
      'BRAND_STANDARDS_VERSION_CONFLICT',
    ]);
    const bad = await call('PUT', '/standards', {
      headers: asAdmin,
      body: { palette: { tokens: [] }, rules: {}, baseVersion: 1 },
    });
    expect([bad.status, bad.json.code]).toEqual([
      400,
      'BRAND_STANDARDS_INVALID',
    ]);
  });
});

describe('GET icons/:id/svg', () => {
  beforeAll(async () => {
    await call('POST', '/icons', {
      headers: asAdmin,
      body: { document: sampleDocument({ id: 'pub', name: 'Công khai' }) },
    });
    await call('POST', '/icons/pub/publish', { headers: asAdmin });
    await call('POST', '/icons', {
      headers: asAdmin,
      body: { document: sampleDocument({ id: 'nhap', name: 'Bản nháp' }) },
    });
  });
  afterEach(() => {
    publicRead = true;
  });

  it('bản đã phát hành đọc công khai với đủ header an toàn và cache bất biến khi có v', async () => {
    const result = await call('GET', '/icons/pub/svg?v=1');
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe(
      'image/svg+xml; charset=utf-8',
    );
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(result.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(result.headers.get('content-disposition')).toBe(
      'inline; filename="cong-khai.svg"',
    );
    expect(result.headers.get('etag')).toMatch(/^"[0-9a-f]{64}-brand-s\d+"$/);
    expect(result.text.startsWith('<svg')).toBe(true);
    expect(result.text).toContain('#2563eb');
    expect(result.text).not.toContain('<script');
  });

  it('không có v thì cache ngắn; mode=mono trả currentColor', async () => {
    const live = await call('GET', '/icons/pub/svg');
    expect(live.headers.get('cache-control')).toBe('public, max-age=300');
    const mono = await call('GET', '/icons/pub/svg?v=1&mode=mono');
    expect(mono.text).toContain('currentColor');
    expect(mono.headers.get('etag')).toMatch(/-mono"$/);
    expect(mono.headers.get('content-disposition')).toContain(
      'cong-khai.mono.svg',
    );
  });

  it('If-None-Match khớp thì 304, không thân', async () => {
    const first = await call('GET', '/icons/pub/svg?v=1');
    const etag = first.headers.get('etag') as string;
    const again = await call('GET', '/icons/pub/svg?v=1', {
      headers: { 'if-none-match': etag },
    });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
    expect(again.headers.get('etag')).toBe(etag);
    expect(again.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('cookie hết hạn không cản việc đọc bản công khai', async () => {
    expect(
      (
        await call('GET', '/icons/pub/svg?v=1', {
          headers: { cookie: 'ep_access=het-han' },
        })
      ).status,
    ).toBe(200);
  });

  it('bản nháp: khách 404, người dùng tenant 404, quản trị 200 với cache riêng', async () => {
    const anonymous = await call('GET', '/icons/nhap/svg?v=1');
    expect([anonymous.status, anonymous.json.code]).toEqual([
      404,
      'BRAND_ICON_NOT_FOUND',
    ]);
    expect(
      (
        await call('GET', '/icons/nhap/svg?v=1', {
          headers: { cookie: 'ep_access=user-token' },
        })
      ).status,
    ).toBe(404);
    const owner = await call('GET', '/icons/nhap/svg?v=1', {
      headers: { cookie: 'ep_access=admin-token' },
    });
    expect(owner.status).toBe(200);
    expect(owner.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(owner.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    const latest = await call('GET', '/icons/nhap/svg', {
      headers: { cookie: 'ep_access=admin-token' },
    });
    expect(latest.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('tắt đọc công khai: khách 401, người dùng đã đăng nhập đọc được bản phát hành', async () => {
    publicRead = false;
    const anonymous = await call('GET', '/icons/pub/svg?v=1');
    expect([anonymous.status, anonymous.json.code]).toEqual([
      401,
      'UNAUTHORIZED',
    ]);
    const user = await call('GET', '/icons/pub/svg?v=1', {
      headers: { cookie: 'ep_access=user-token' },
    });
    expect(user.status).toBe(200);
    expect(user.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    );
  });

  it('tham số sai: 400; phiên bản không có: 404; mã icon lạ: 404', async () => {
    expect((await call('GET', '/icons/pub/svg?v=0')).json.code).toBe(
      'BRAND_REQUEST_INVALID',
    );
    expect((await call('GET', '/icons/pub/svg?v=abc')).status).toBe(400);
    expect((await call('GET', '/icons/pub/svg?mode=evil')).status).toBe(400);
    expect(
      (
        await call('GET', '/icons/pub/svg?v=7', {
          headers: { cookie: 'ep_access=admin-token' },
        })
      ).json.code,
    ).toBe('BRAND_ICON_VERSION_NOT_FOUND');
    expect((await call('GET', '/icons/khong-co/svg')).status).toBe(404);
    // Mã mang dấu gạch chéo mã hoá không bao giờ tới được kho: bị chặn ở bước kiểm mã (hoặc không khớp route).
    const traversal = await call('GET', '/icons/..%2Ftenants%2Fx/svg');
    expect([400, 404]).toContain(traversal.status);
    expect(objects.gets.some((key) => key.includes('tenants'))).toBe(false);
  });
});
