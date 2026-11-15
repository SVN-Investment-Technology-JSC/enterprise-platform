import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { configureHttpSecurity, isPersonalDataPath, noStorePersonalData } from './http-security';

describe('isPersonalDataPath (SEC-OPS005-01)', () => {
  it.each([
    '/api/auth/v1/me',
    '/api/auth/v1/refresh',
    '/api/auth/v1/login',
    '/api/platform/v1/me',
    '/api/hrm/v1/my-profile',
    '/api/hrm/v1/my-payslips?month=2026-10',
    '/api/hrm/v1/my-notifications',
    '/api/hrm/v1/request-quota/me',
    '/api/workspace/v1/me/inbox',
    '/api/realtime/v1/notifications',
    '/api/realtime/v1/summary',
    '/api/social/v1/notifications/',
  ])('%s là dữ liệu cá nhân', (path) => {
    expect(isPersonalDataPath(path)).toBe(true);
  });

  it.each([
    '/api/auth/v1/jwks',
    '/api/platform/v1/modules',
    '/api/inventory/v1/items',
    '/api/hrm/v1/employees',
    '/api/crm/v1/customers/menu',
  ])('%s không bắt buộc no-store (SEC-OPS005-04)', (path) => {
    expect(isPersonalDataPath(path)).toBe(false);
  });
});

describe('noStorePersonalData', () => {
  const run = (originalUrl: string) => {
    const headers = new Map<string, string>();
    const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    noStorePersonalData({ originalUrl, url: originalUrl } as Request, response, next);
    return { headers, next };
  };

  it('đặt Cache-Control: no-store cho /api/auth/v1/me', () => {
    const { headers, next } = run('/api/auth/v1/me');
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });

  it('không đụng tới route danh mục', () => {
    const { headers, next } = run('/api/platform/v1/modules');
    expect(headers.has('Cache-Control')).toBe(false);
    expect(next).toHaveBeenCalled();
  });
});

describe('configureHttpSecurity', () => {
  it('tắt x-powered-by và gắn middleware no-store', () => {
    const disable = jest.fn();
    const use = jest.fn();
    const app = {
      getHttpAdapter: () => ({ getInstance: () => ({ disable }) }),
      use,
    } as unknown as INestApplication;
    configureHttpSecurity(app);
    expect(disable).toHaveBeenCalledWith('x-powered-by');
    expect(use).toHaveBeenCalledWith(noStorePersonalData);
  });
});
