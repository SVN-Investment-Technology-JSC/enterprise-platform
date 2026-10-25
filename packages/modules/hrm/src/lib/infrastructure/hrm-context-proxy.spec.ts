import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { assertNotProxyCreatorDecision } from './hrm-approval-policy.js';
import { HrmContextService } from './hrm-context.service.js';
import type { HrmRequestProxyService } from './hrm-request-proxy.js';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
jest.mock('./hrm-procedure-api.js', () => ({ isProcedureReachable: jest.fn() }));

const USER = 'u-actor';
const OWN_EMPLOYEE = 'e-own';
const OTHER_EMPLOYEE = 'e-other';

function setup(options: { ownRows?: number; assert?: jest.Mock } = {}) {
  const assertCanCreateFor = options.assert ?? jest.fn().mockResolvedValue(undefined);
  const proxy = { assertCanCreateFor } as unknown as HrmRequestProxyService;
  const service = new HrmContextService({} as never, {} as never, proxy);
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: options.ownRows ?? 0 }),
  };
  const context = { principal: { userId: USER, permissions: [] as string[] }, tenantId: 't1', pool };
  jest.spyOn(service, 'getContext').mockResolvedValue(context as never);
  const getRequestContext = jest
    .spyOn(service, 'getRequestContext')
    .mockImplementation(async (_req, employeeId) => ({ ...context, employeeId: employeeId ?? OWN_EMPLOYEE }) as never);
  return { service, assertCanCreateFor, getRequestContext, req: {} as Request };
}

describe('getProxyRequestContext', () => {
  it('không truyền nhân viên: đơn tự tạo của chính mình, không dấu tạo hộ', async () => {
    const { service, req, assertCanCreateFor } = setup();
    const result = await service.getProxyRequestContext(req, undefined, 'leave');
    expect(result.onBehalf).toBeUndefined();
    expect(assertCanCreateFor).not.toHaveBeenCalled();
  });

  it('truyền đúng hồ sơ của mình: vẫn là đơn tự tạo', async () => {
    const { service, req, assertCanCreateFor, getRequestContext } = setup({ ownRows: 1 });
    const result = await service.getProxyRequestContext(req, OWN_EMPLOYEE, 'ot', 'không dùng');
    expect(result.onBehalf).toBeUndefined();
    expect(assertCanCreateFor).not.toHaveBeenCalled();
    expect(getRequestContext).toHaveBeenCalledWith(req, OWN_EMPLOYEE);
  });

  it('nhân viên khác: kiểm phạm vi, bắt buộc lý do và trả dấu đơn tạo hộ', async () => {
    const { service, req, assertCanCreateFor } = setup();
    const result = await service.getProxyRequestContext(req, OTHER_EMPLOYEE, 'business_trip', '  Nhân viên đang công tác  ');
    expect(assertCanCreateFor).toHaveBeenCalledWith(expect.anything(), 'business_trip', OTHER_EMPLOYEE);
    expect(result.employeeId).toBe(OTHER_EMPLOYEE);
    expect(result.onBehalf).toEqual({ reason: 'Nhân viên đang công tác' });
  });

  it('thiếu lý do thì 400 và chưa tạo gì', async () => {
    const { service, req } = setup();
    await expect(service.getProxyRequestContext(req, OTHER_EMPLOYEE, 'leave')).rejects.toMatchObject({
      response: { code: 'HRM_PROXY_REASON_REQUIRED' },
    });
  });

  it('ngoài phạm vi hoặc thiếu quyền thì lỗi của kiểm tra phạm vi được giữ nguyên', async () => {
    const assert = jest.fn().mockRejectedValue(new ForbiddenException({ code: 'HRM_PROXY_OUT_OF_SCOPE', message: 'ngoài phạm vi' }));
    const { service, req } = setup({ assert });
    await expect(service.getProxyRequestContext(req, OTHER_EMPLOYEE, 'leave', 'lý do')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('getRequestContextOrProxy', () => {
  it('quyền thông thường đủ thì không đi vào kiểm tra phạm vi tạo hộ', async () => {
    const { service, req, assertCanCreateFor } = setup();
    const result = await service.getRequestContextOrProxy(req, OTHER_EMPLOYEE, 'leave');
    expect(result.employeeId).toBe(OTHER_EMPLOYEE);
    expect(assertCanCreateFor).not.toHaveBeenCalled();
  });

  it('bị 403 thì dùng quyền tạo hộ, không đòi lý do vì chưa tạo đơn', async () => {
    const { service, req, assertCanCreateFor, getRequestContext } = setup();
    getRequestContext.mockRejectedValueOnce(new ForbiddenException('thiếu quyền'));
    const result = await service.getRequestContextOrProxy(req, OTHER_EMPLOYEE, 'leave');
    expect(assertCanCreateFor).toHaveBeenCalledWith(expect.anything(), 'leave', OTHER_EMPLOYEE);
    expect(result.employeeId).toBe(OTHER_EMPLOYEE);
  });

  it('không chỉ định nhân viên thì giữ nguyên lỗi 403', async () => {
    const { service, req, getRequestContext } = setup();
    getRequestContext.mockRejectedValueOnce(new ForbiddenException('thiếu quyền'));
    await expect(service.getRequestContextOrProxy(req, undefined, 'leave')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('người tạo hộ không được duyệt đơn do mình tạo hộ', () => {
  const dbOf = (row?: Record<string, unknown>, ready = true) => ({
    query: jest.fn(async (sql: string) =>
      /information_schema.columns/.test(sql) ? { rows: [{ ready }] } : { rows: row ? [row] : [] },
    ),
  });
  const deps = (row?: Record<string, unknown>, ready = true) => ({ db: dbOf(row, ready) as never, tenantId: 't1' });

  it('chặn duyệt, từ chối, huỷ hiệu lực khi chính họ là người tạo hộ', async () => {
    for (const action of ['approve', 'reject', 'reverse', 'REJECT'])
      await expect(
        assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'leave', action, deps({ submitted_by: USER, created_on_behalf: true })),
      ).rejects.toMatchObject({ response: { code: 'HRM_PROXY_CREATOR_DECISION_FORBIDDEN' } });
  });

  it('rút đơn không bị chặn', async () => {
    await expect(
      assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'ot', 'cancel', deps({ submitted_by: USER, created_on_behalf: true })),
    ).resolves.toBeUndefined();
  });

  it('người khác duyệt đơn tạo hộ, hoặc đơn tự gửi, đều được', async () => {
    await expect(
      assertNotProxyCreatorDecision({ userId: 'u-boss' }, 'r1', 'leave', 'approve', deps({ submitted_by: USER, created_on_behalf: true })),
    ).resolves.toBeUndefined();
    await expect(
      assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'leave', 'approve', deps({ submitted_by: USER, created_on_behalf: false })),
    ).resolves.toBeUndefined();
    await expect(assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'leave', 'approve', deps(undefined))).resolves.toBeUndefined();
  });

  it('cơ sở dữ liệu chưa có cột tạo hộ (chưa chạy migration) thì không chặn gì', async () => {
    const d = deps({ submitted_by: USER, created_on_behalf: true }, false);
    await expect(assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'leave', 'approve', d)).resolves.toBeUndefined();
  });

  it('các loại đơn không hỗ trợ tạo hộ thì không kiểm tra thêm', async () => {
    const d = deps({ submitted_by: USER, created_on_behalf: true });
    await expect(assertNotProxyCreatorDecision({ userId: USER }, 'r1', 'advance', 'approve', d)).resolves.toBeUndefined();
    expect((d.db as { query: jest.Mock }).query).not.toHaveBeenCalled();
  });
});
