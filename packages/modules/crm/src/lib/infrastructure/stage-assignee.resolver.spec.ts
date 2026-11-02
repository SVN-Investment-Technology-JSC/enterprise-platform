import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import { HttpOrganizationScope } from './http-organization-scope.js';
import type { ReportingLineSnapshot } from '../domain/reporting-line.js';
import { computeManagerLevels, StageAssigneeResolver } from '../application/stage-assignee.resolver.js';

// NV1 -> TN -> QL; chức danh GD chưa có người.
const snapshot: ReportingLineSnapshot = {
  positions: [
    { id: 'p-nv', reportsToPositionId: 'p-tn' },
    { id: 'p-tn', reportsToPositionId: 'p-ql' },
    { id: 'p-ql', reportsToPositionId: 'p-gd' },
    { id: 'p-gd', reportsToPositionId: null },
  ],
  assignments: [
    { userId: 'nv1', positionId: 'p-nv' },
    { userId: 'tn', positionId: 'p-tn' },
    { userId: 'ql', positionId: 'p-ql' },
  ],
};
const people = ['nv1', 'tn', 'ql'].map((userId) => ({ userId, displayName: userId }));

function org(overrides: Partial<{ snapshot: () => Promise<ReportingLineSnapshot>; people: () => Promise<typeof people> }> = {}) {
  return { snapshot: async () => snapshot, people: async () => people, ...overrides };
}
const base = { tenantId: 't1', ownerUserId: 'nv1' };

describe('StageAssigneeResolver', () => {
  it('TC-ASG-01: PROJECT_OWNER gán chủ dự án, không cần đọc tổ chức', async () => {
    const reader = { snapshot: jest.fn(), people: jest.fn() };
    const result = await new StageAssigneeResolver(reader).resolve({ ...base, rule: 'PROJECT_OWNER' });
    expect(result).toEqual({ userId: 'nv1' });
    expect(reader.snapshot).not.toHaveBeenCalled();
  });

  it('NONE để trống, không cảnh báo', async () => {
    expect(await new StageAssigneeResolver(org()).resolve({ ...base, rule: 'NONE' })).toEqual({ userId: null });
  });

  it('TC-ASG-02: DIRECT_MANAGER gán quản lý trực tiếp', async () => {
    expect(await new StageAssigneeResolver(org()).resolve({ ...base, rule: 'DIRECT_MANAGER' })).toEqual({ userId: 'tn' });
  });

  it('TC-ASG-03: MANAGER_LEVEL 2 gán cấp trên hai bậc', async () => {
    const resolver = new StageAssigneeResolver(org());
    expect(await resolver.resolve({ ...base, rule: 'MANAGER_LEVEL', param: '2' })).toEqual({ userId: 'ql' });
    expect(await resolver.resolve({ ...base, rule: 'MANAGER_LEVEL', param: '1' })).toEqual({ userId: 'tn' });
  });

  it('POSITION gán người đang giữ chức danh (Q-P2-12)', async () => {
    const resolver = new StageAssigneeResolver(org());
    expect(await resolver.resolve({ ...base, rule: 'POSITION', param: 'p-ql' })).toEqual({ userId: 'ql' });
  });

  it('POSITION nhiều người giữ thì chọn ổn định (id nhỏ nhất), bỏ người không còn hoạt động', async () => {
    const shared: ReportingLineSnapshot = {
      positions: [{ id: 'p-x', reportsToPositionId: null }],
      assignments: [
        { userId: 'b', positionId: 'p-x' },
        { userId: 'a', positionId: 'p-x' },
        { userId: 'gone', positionId: 'p-x' },
      ],
    };
    const result = await new StageAssigneeResolver(
      org({ snapshot: async () => shared, people: async () => ['a', 'b'].map((userId) => ({ userId, displayName: userId })) }),
    ).resolve({ ...base, rule: 'POSITION', param: 'p-x' });
    expect(result).toEqual({ userId: 'a' });
  });

  it('POSITION chức danh trống người hoặc không tồn tại thì để trống kèm cảnh báo', async () => {
    const resolver = new StageAssigneeResolver(org());
    expect(await resolver.resolve({ ...base, rule: 'POSITION', param: 'p-gd' })).toMatchObject({
      userId: null,
      warning: { code: 'POSITION_EMPTY' },
    });
    expect(await resolver.resolve({ ...base, rule: 'POSITION', param: 'p-khong-co' })).toMatchObject({
      warning: { code: 'POSITION_EMPTY' },
    });
    expect(await resolver.resolve({ ...base, rule: 'POSITION' })).toMatchObject({ warning: { code: 'INVALID_PARAM' } });
  });

  it('POSITION khi Tenant Core lỗi thì trống kèm cảnh báo, không đoán', async () => {
    const failing = org({ snapshot: async () => Promise.reject(new CrmOrganizationUnavailableError()) });
    expect(await new StageAssigneeResolver(failing).resolve({ ...base, rule: 'POSITION', param: 'p-ql' })).toMatchObject({
      userId: null,
      warning: { code: 'ORGANIZATION_UNAVAILABLE' },
    });
  });

  it('MANAGER_LEVEL bỏ qua chức danh trống người khi đếm bậc', () => {
    const gap: ReportingLineSnapshot = {
      positions: [
        { id: 'a', reportsToPositionId: 'empty' },
        { id: 'empty', reportsToPositionId: 'c' },
        { id: 'c', reportsToPositionId: null },
      ],
      assignments: [
        { userId: 'u', positionId: 'a' },
        { userId: 'boss', positionId: 'c' },
      ],
    };
    expect(computeManagerLevels(gap, 'u')).toEqual([['boss']]);
  });

  it('ô ghi đè "Báo cáo cho" của phân công thắng chức danh', () => {
    const overridden: ReportingLineSnapshot = {
      ...snapshot,
      assignments: [{ userId: 'nv1', positionId: 'p-nv', reportsToOverrideId: 'p-ql' }, ...snapshot.assignments.slice(1)],
    };
    expect(computeManagerLevels(overridden, 'nv1')[0]).toEqual(['ql']);
  });

  it('chuỗi có vòng lặp thì dừng, không treo', () => {
    const loop: ReportingLineSnapshot = {
      positions: [
        { id: 'a', reportsToPositionId: 'b' },
        { id: 'b', reportsToPositionId: 'a' },
      ],
      assignments: [
        { userId: 'u', positionId: 'a' },
        { userId: 'v', positionId: 'b' },
      ],
    };
    expect(computeManagerLevels(loop, 'u')).toEqual([['v']]);
  });

  it('TC-ASG-04: FIXED_USER hợp lệ thì gán; người bị vô hiệu thì trống kèm cảnh báo, không lỗi', async () => {
    const resolver = new StageAssigneeResolver(org());
    expect(await resolver.resolve({ ...base, rule: 'FIXED_USER', param: 'ql' })).toEqual({ userId: 'ql' });
    const inactive = await resolver.resolve({ ...base, rule: 'FIXED_USER', param: 'da-nghi-viec' });
    expect(inactive.userId).toBeNull();
    expect(inactive.warning?.code).toBe('FIXED_USER_INACTIVE');
  });

  it('FIXED_USER thiếu tham số thì cảnh báo INVALID_PARAM', async () => {
    const result = await new StageAssigneeResolver(org()).resolve({ ...base, rule: 'FIXED_USER' });
    expect(result.warning?.code).toBe('INVALID_PARAM');
  });

  it('TC-ASG-05: không có quản lý thì trống kèm cảnh báo', async () => {
    const resolver = new StageAssigneeResolver(org());
    const top = await resolver.resolve({ ...base, ownerUserId: 'ql', rule: 'MANAGER_LEVEL', param: '3' });
    expect(top).toMatchObject({ userId: null, warning: { code: 'MANAGER_NOT_FOUND' } });
    const direct = await resolver.resolve({ ...base, ownerUserId: 'ql', rule: 'DIRECT_MANAGER' });
    expect(direct).toMatchObject({ userId: null, warning: { code: 'MANAGER_NOT_FOUND' } });
    const stranger = await resolver.resolve({ ...base, ownerUserId: 'khong-co', rule: 'DIRECT_MANAGER' });
    expect(stranger).toMatchObject({ userId: null, warning: { code: 'OWNER_NOT_IN_ORGANIZATION' } });
  });

  it('tham số số bậc và quy tắc lạ không hợp lệ thì cảnh báo, không lỗi', async () => {
    const resolver = new StageAssigneeResolver(org());
    for (const param of ['0', 'abc', '1.5', '99', undefined]) {
      const result = await resolver.resolve({ ...base, rule: 'MANAGER_LEVEL', param });
      expect(result.warning?.code).toBe('INVALID_PARAM');
    }
    expect((await resolver.resolve({ ...base, rule: 'KHONG_CO' })).warning?.code).toBe('INVALID_RULE');
  });

  it('TC-ASG-11: Tenant Core lỗi thì trống kèm cảnh báo, không đoán người', async () => {
    const failing = org({
      snapshot: async () => {
        throw new CrmOrganizationUnavailableError();
      },
    });
    const resolver = new StageAssigneeResolver(failing);
    for (const rule of ['DIRECT_MANAGER', 'MANAGER_LEVEL', 'FIXED_USER']) {
      const result = await resolver.resolve({ ...base, rule, param: '1' });
      expect(result).toMatchObject({ userId: null, warning: { code: 'ORGANIZATION_UNAVAILABLE' } });
    }
    // Quy tắc không cần tổ chức vẫn chạy.
    expect(await resolver.resolve({ ...base, rule: 'PROJECT_OWNER' })).toEqual({ userId: 'nv1' });
  });

  describe('qua HttpOrganizationScope thật (fetch giả)', () => {
    const payload = {
      units: [
        { id: 'p-nv', reportsToPositionId: 'p-tn' },
        { id: 'p-tn', reportsToPositionId: null },
      ],
      members: [
        { userId: 'nv1', positionId: 'p-nv', displayName: 'NV1' },
        { userId: 'tn', positionId: 'p-tn', displayName: 'TN' },
      ],
    };

    it('TC-ASG-02: đọc payload và gán quản lý trực tiếp; cache 60 giây chỉ gọi một lần', async () => {
      const fetcher = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
      const resolver = new StageAssigneeResolver(new HttpOrganizationScope('http://core', 'tok', fetcher));
      expect(await resolver.resolve({ ...base, rule: 'DIRECT_MANAGER' })).toEqual({ userId: 'tn' });
      expect(await resolver.resolve({ ...base, rule: 'FIXED_USER', param: 'tn' })).toEqual({ userId: 'tn' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('TC-ASG-12: Tenant Core 500 và chưa có cache thì trống kèm cảnh báo; có cache cũ thì dùng bản cũ', async () => {
      let nowValue = 0;
      const fetcher = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload } as Response)
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
      const scope = new HttpOrganizationScope('http://core', 'tok', fetcher, () => nowValue);
      const resolver = new StageAssigneeResolver(scope);
      expect(await resolver.resolve({ ...base, rule: 'DIRECT_MANAGER' })).toEqual({ userId: 'tn' });
      nowValue = 61_000;
      expect(await resolver.resolve({ ...base, rule: 'DIRECT_MANAGER' })).toEqual({ userId: 'tn' });

      const cold = new StageAssigneeResolver(new HttpOrganizationScope('http://core', 'tok', fetcher, () => 0));
      expect(await cold.resolve({ ...base, tenantId: 't-moi', rule: 'DIRECT_MANAGER' })).toMatchObject({
        userId: null,
        warning: { code: 'ORGANIZATION_UNAVAILABLE' },
      });
    });
  });
});
