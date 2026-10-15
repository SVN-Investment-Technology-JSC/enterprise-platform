import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { TenantLimitsController } from './tenant-limits.controller';
import { resolveTenantLimits, TenantLimitsService } from './tenant-limits';

const TENANT = '0f1e2d3c-4b5a-4987-8654-3210fedcba98';

describe('resolveTenantLimits', () => {
  it('dùng mức mặc định 50 GB, chặn cứng, khi tenant chưa gắn gói', () => {
    expect(resolveTenantLimits(TENANT, [], [])).toEqual({
      tenantId: TENANT,
      limits: [
        { resourceKey: 'storage_gb', limitValue: 50, enforcement: 'hard', source: 'default', addOnValue: 0 },
      ],
    });
  });

  it('lấy hạn mức theo gói và cộng gói mua thêm', () => {
    const { limits } = resolveTenantLimits(
      TENANT,
      [
        { resource_key: 'storage_gb', limit_value: 500, enforcement: 'hard', plan_key: 'enterprise' },
        { resource_key: 'active_users', limit_value: 500, enforcement: 'hard', plan_key: 'enterprise' },
      ],
      [{ resource_key: 'storage_gb', amount: 200 }],
    );
    expect(limits).toEqual([
      { resourceKey: 'active_users', limitValue: 500, enforcement: 'hard', source: 'plan', planKey: 'enterprise', addOnValue: 0 },
      { resourceKey: 'storage_gb', limitValue: 700, enforcement: 'hard', source: 'plan', planKey: 'enterprise', addOnValue: 200 },
    ]);
  });

  it('gói mua thêm vẫn cộng vào mức mặc định', () => {
    const [storage] = resolveTenantLimits(TENANT, [], [{ resource_key: 'storage_gb', amount: 100 }]).limits;
    expect(storage).toMatchObject({ limitValue: 150, source: 'default', addOnValue: 100 });
  });

  it('bỏ qua gói mua thêm cho tài nguyên không có mức nền', () => {
    const { limits } = resolveTenantLimits(TENANT, [], [{ resource_key: 'sms', amount: 1000 }]);
    expect(limits.map((limit) => limit.resourceKey)).toEqual(['storage_gb']);
  });
});

describe('TenantLimitsService', () => {
  const query = jest.fn();
  const service = new TenantLimitsService({ query } as never);
  beforeEach(() => query.mockReset());

  it('không hỏi DB với tenant id sai định dạng', async () => {
    await expect(service.limits('not-a-uuid')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('trả mặc định khi DB chưa có bảng hạn mức', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }));
    await expect(service.limits(TENANT)).resolves.toMatchObject({
      limits: [{ resourceKey: 'storage_gb', limitValue: 50, source: 'default' }],
    });
  });
});

describe('TenantLimitsController', () => {
  const limits = { limits: jest.fn() };
  const controller = new TenantLimitsController(limits as unknown as TenantLimitsService);
  const request = (token?: string) => ({ headers: token ? { 'x-service-token': token } : {} }) as Request;
  const previous = process.env.INTERNAL_SERVICE_TOKEN;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'service-secret';
    limits.limits.mockReset();
  });
  afterAll(() => {
    process.env.INTERNAL_SERVICE_TOKEN = previous;
  });

  it('chỉ trả lời lời gọi có service token', async () => {
    await expect(controller.tenantLimits(request('wrong'), TENANT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limits.limits).not.toHaveBeenCalled();
  });

  it('báo 404 khi tenant không tồn tại', async () => {
    limits.limits.mockResolvedValue(null);
    await expect(controller.tenantLimits(request('service-secret'), TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
