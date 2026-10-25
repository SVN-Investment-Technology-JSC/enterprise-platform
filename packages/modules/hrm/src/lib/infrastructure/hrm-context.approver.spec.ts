import { ForbiddenException } from '@nestjs/common';
import type { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import type { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmContextService } from './hrm-context.service';
import { assignedRequestIds } from './hrm-approval-policy';

jest.mock('@enterprise-platform/platform-identity', () => ({
  PlatformIdentityService: class {},
}));
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));
jest.mock('./hrm-procedure-api', () => ({ isProcedureReachable: jest.fn() }));
jest.mock('./hrm-approval-policy', () => ({
  assignedKindsWithoutPermission: jest.fn(),
  assignedRequestIds: jest.fn(),
}));

describe('approverContext', () => {
  const req = {} as Request;
  const base = { pool: {}, tenantId: 't1', principal: { userId: 'backup' } };
  const make = () =>
    new HrmContextService({} as unknown as PlatformIdentityService, {} as unknown as PostgresPoolRegistry);
  const spy = (service: HrmContextService, impl: (permission: string) => unknown) =>
    jest.spyOn(service, 'getContext').mockImplementation((async (_r: Request, permission: string) =>
      impl(permission)) as never);
  const denyApprove = (permission: string) => {
    if (permission === 'hrm.request.approve') throw new ForbiddenException('no');
    return base;
  };
  beforeEach(() => jest.clearAllMocks());

  it('dùng ngay quyền duyệt khi người dùng có quyền', async () => {
    const service = make();
    const getContext = spy(service, () => base);
    await expect(service.approverContext(req, 'hrm.request.approve', 'ot', 'r1')).resolves.toBe(base);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(assignedRequestIds).not.toHaveBeenCalled();
  });

  it('cho người dự phòng không có quyền duyệt nhưng được giao đúng đơn', async () => {
    const service = make();
    spy(service, denyApprove);
    (assignedRequestIds as jest.Mock).mockResolvedValue(['r1', 'r2']);
    await expect(service.approverContext(req, 'hrm.request.approve', 'ot', 'r1')).resolves.toBe(base);
    expect(assignedRequestIds).toHaveBeenCalledWith(base.pool, 't1', 'ot', 'backup');
  });

  it('vẫn từ chối khi đơn không được giao cho người này', async () => {
    const service = make();
    spy(service, denyApprove);
    (assignedRequestIds as jest.Mock).mockResolvedValue(['other']);
    await expect(service.approverContext(req, 'hrm.request.approve', 'ot', 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('không nuốt lỗi khác 403 (chưa đăng nhập)', async () => {
    const service = make();
    spy(service, () => {
      throw new Error('boom');
    });
    await expect(service.approverContext(req, 'hrm.request.approve', 'ot', 'r1')).rejects.toThrow('boom');
    expect(assignedRequestIds).not.toHaveBeenCalled();
  });
});
