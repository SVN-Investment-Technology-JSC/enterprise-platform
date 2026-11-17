import type { Request } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { TenantCoreAccess } from './tenant-core-access.js';

jest.mock('./platform-identity.service.js', () => ({
  PlatformIdentityService: class PlatformIdentityService {},
}));

describe('TenantCoreAccess.requireCsrf', () => {
  const access = new TenantCoreAccess({} as never);

  it('cho phép client di động xác thực bằng Authorization: Bearer bỏ qua cookie CSRF', () => {
    const req = {
      headers: { authorization: 'Bearer valid-mobile-jwt' },
      cookies: {},
    } as unknown as Request;
    expect(() => access.requireCsrf(req)).not.toThrow();
  });

  it('bắt buộc x-csrf-token khớp cookie ep_csrf khi dùng phiên trình duyệt', () => {
    const missing = {
      headers: {},
      cookies: { ep_access: 'jwt' },
    } as unknown as Request;
    expect(() => access.requireCsrf(missing)).toThrow(ForbiddenException);

    const mismatch = {
      headers: { 'x-csrf-token': 'wrong' },
      cookies: { ep_access: 'jwt', ep_csrf: 'right' },
    } as unknown as Request;
    expect(() => access.requireCsrf(mismatch)).toThrow(ForbiddenException);

    const valid = {
      headers: { 'x-csrf-token': 'csrf-123' },
      cookies: { ep_access: 'jwt', ep_csrf: 'csrf-123' },
    } as unknown as Request;
    expect(() => access.requireCsrf(valid)).not.toThrow();
  });
});
