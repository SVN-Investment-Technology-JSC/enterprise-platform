import 'reflect-metadata';
import type { Request } from 'express';
import type { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmCustodyController } from './hrm-custody.controller';

jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const EMP = '00000000-0000-4000-8000-0000000000e1';
const req = { headers: {} } as Request;

function build(employmentStatus: string | null = 'ACTIVE') {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('employee_directory'))
      return employmentStatus
        ? { rows: [{ employment_status: employmentStatus }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const getContext = jest.fn().mockResolvedValue({
    tenantId: 't1',
    principal: { userId: 'u-hr' },
    pool: { query },
  });
  const controller = new HrmCustodyController({ getContext } as unknown as HrmContextService);
  return { controller, getContext, query };
}

let fetchMock: jest.Mock;
function inventory(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body ?? {} };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

describe('HrmCustodyController', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'svc';
    process.env.INVENTORY_API_URL = 'http://kho/api/inventory';
  });

  it('cấp: kiểm quyền hrm.custody.manage, gọi Kho bằng service token rồi ghi nhật ký HRM', async () => {
    const { controller, getContext, query } = build();
    inventory(() => ({ status: 201, body: { ok: true } }));

    await controller.assign(req, EMP, { materialCode: 'TS-001' });

    expect(getContext).toHaveBeenCalledWith(req, 'hrm.custody.manage');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://kho/api/inventory/v1/internal/custody/assign');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'svc' });
    expect(JSON.parse(init.body)).toEqual({ materialCode: 'TS-001', employeeId: EMP });
    const audit = query.mock.calls.find((c) => String(c[0]).includes('audit_log'));
    expect(audit?.[1]).toEqual(expect.arrayContaining(['t1', 'u-hr', 'CUSTODY_ASSIGNED', EMP]));
  });

  it('không cấp cho nhân viên đã nghỉ việc và không gọi Kho', async () => {
    const { controller } = build('RESIGNED');
    inventory(() => ({ status: 201 }));
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nhân viên không tồn tại thì 404, không gọi Kho', async () => {
    const { controller } = build(null);
    inventory(() => ({ status: 201 }));
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Kho từ chối (tài sản đang bảo trì) thì giữ nguyên thông điệp tiếng Việt, 409, không ghi nhật ký', async () => {
    const { controller, query } = build();
    inventory(() => ({
      status: 409,
      body: { code: 'CUSTODY_ASSET_UNAVAILABLE', message: 'Tài sản TS-001 không ở trạng thái hoạt động.' },
    }));
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'CUSTODY_ASSET_UNAVAILABLE', message: 'Tài sản TS-001 không ở trạng thái hoạt động.' },
    });
    expect(query.mock.calls.some((c) => String(c[0]).includes('audit_log'))).toBe(false);
  });

  it('Kho không trả lời hoặc 5xx thì 503 INVENTORY_UNAVAILABLE', async () => {
    const { controller } = build();
    inventory(() => ({ status: 502 }));
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({
      status: 503,
      response: { code: 'INVENTORY_UNAVAILABLE' },
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({ status: 503 });
  });

  it('thiếu INTERNAL_SERVICE_TOKEN thì 503, không gửi request', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const { controller } = build();
    inventory(() => ({ status: 201 }));
    await expect(controller.assign(req, EMP, { materialCode: 'TS-001' })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('thu hồi: chỉ khi nhân viên đang giữ tài sản; người đã nghỉ việc vẫn thu hồi được', async () => {
    const { controller } = build('RESIGNED');
    inventory((url) =>
      url.endsWith(`/custody/employees/${EMP}`)
        ? { status: 200, body: [{ id: 'm1', code: 'TS-001', name: 'Laptop' }] }
        : { status: 201, body: { ok: true } },
    );

    await controller.revoke(req, EMP, 'TS-001');

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(post?.[1].body)).toEqual({ materialCode: 'TS-001', employeeId: null });
  });

  it('không thu hồi tài sản của người khác qua đường dẫn của nhân viên này', async () => {
    const { controller } = build();
    inventory(() => ({ status: 200, body: [{ id: 'm9', code: 'TS-999', name: 'Khác' }] }));
    await expect(controller.revoke(req, EMP, 'TS-001')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it('danh sách tài sản có thể cấp: kiểm quyền cấp phát, không phải quyền đọc hồ sơ', async () => {
    const { controller, getContext } = build();
    inventory(() => ({ status: 200, body: [{ id: 'm2', code: 'TS-002', name: 'Màn hình' }] }));
    const result = await controller.assignable(req);
    expect(getContext).toHaveBeenCalledWith(req, 'hrm.custody.manage');
    expect(result).toHaveLength(1);
  });
});
