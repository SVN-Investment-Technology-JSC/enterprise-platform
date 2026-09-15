import type { Request } from 'express';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import {
  TenantDeletionError,
  TenantDeletionService,
} from '@enterprise-platform/platform-tenancy/deletion';
import { PlatformIdentityService } from './platform-identity.service';
import { TenantDeletionController } from './tenant-deletion.controller';

jest.mock('./platform-identity.service', () => ({
  PlatformIdentityService: class {},
}));

describe('TenantDeletionController', () => {
  const identity = { verifyAccessToken: jest.fn() };
  const deletion = {
    preview: jest.fn(),
    request: jest.fn(),
    get: jest.fn(),
    retry: jest.fn(),
    list: jest.fn(),
  };
  const controller = new TenantDeletionController(
    identity as unknown as PlatformIdentityService,
    deletion as unknown as TenantDeletionService,
  );
  const request = {
    headers: {},
    cookies: { ep_access: 'signed', ep_csrf: 'csrf' },
    get: (key: string) => (key === 'idempotency-key' ? 'request-id' : 'csrf'),
  } as unknown as Request;
  beforeEach(() => jest.resetAllMocks());
  it('does not call the deletion service without a verified principal', async () => {
    identity.verifyAccessToken.mockRejectedValue(new Error('revoked'));
    await expect(controller.preview(request, 'tenant')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(deletion.preview).not.toHaveBeenCalled();
  });
  it('passes the actual confirmation and both CSRF values to the authorized service', async () => {
    const principal = { kind: 'platform-admin' };
    const input = { confirmSlug: 'typed', previewToken: 'preview' };
    identity.verifyAccessToken.mockResolvedValue(principal);
    deletion.request.mockResolvedValue({ status: 'pending' });
    await controller.request(request, 'tenant', input);
    expect(deletion.request).toHaveBeenCalledWith(
      'tenant',
      input,
      'request-id',
      principal,
      { header: 'csrf', cookie: 'csrf' },
    );
  });
  it('preserves forbidden responses and never sends database errors or secrets to clients', async () => {
    identity.verifyAccessToken.mockResolvedValue({ kind: 'platform-admin' });
    deletion.preview.mockRejectedValue(
      new TenantDeletionError(403, 'FORBIDDEN'),
    );
    await expect(controller.preview(request, 'tenant')).rejects.toMatchObject({
      status: 403,
    });
    deletion.preview.mockRejectedValue(
      new Error('postgresql://user:secret@host/database'),
    );
    try {
      await controller.preview(request, 'tenant');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).not.toEqual(
        expect.objectContaining({ message: expect.stringContaining('secret') }),
      );
    }
  });
});
