import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { OrgSnapshotLike } from './hrm-approval-policy.js';
import {
  HrmRequestProxyService,
  applicableProxyRules,
  canCreateBehalf,
  hasUnrestrictedProxy,
  markOnBehalf,
  normalizeProxyRuleInput,
  onBehalfView,
  requireProxyReason,
  resolveProxyScope,
  unitWithDescendants,
  type ProxyDirectoryEntry,
  type ProxyRule,
} from './hrm-request-proxy.js';

const ACTOR = 'u-actor';
const dir = (id: string, userId: string | null): ProxyDirectoryEntry => ({
  employeeId: `e-${id}`,
  userId,
  employeeCode: `NV-${id}`,
  fullName: `Nhân viên ${id}`,
});
const DIRECTORY = [dir('actor', ACTOR), dir('a', 'u-a'), dir('b', 'u-b'), dir('c', 'u-c'), dir('d', 'u-d'), dir('noacct', null)];

/** actor thuộc đơn vị U1 cùng a; b ở U2 (con của U1); c ở U3; d ở U4 (con của U3). */
const SNAPSHOT: OrgSnapshotLike = {
  units: [
    { id: 'U1' },
    { id: 'U2', parentId: 'U1' },
    { id: 'U3' },
    { id: 'U4', parentId: 'U3' },
  ],
  members: [
    { userId: ACTOR, unitId: 'U1' },
    { userId: 'u-a', unitId: 'U1' },
    { userId: 'u-b', unitId: 'U2' },
    { userId: 'u-c', unitId: 'U3' },
    { userId: 'u-d', unitId: 'U4' },
  ],
};

const rule = (patch: Partial<ProxyRule>): ProxyRule => ({
  id: 'r1',
  name: 'Cấu hình',
  granteeUserId: null,
  requestKinds: ['leave', 'ot', 'business_trip'],
  scopeType: 'SUBORDINATES',
  unitIds: [],
  employeeIds: [],
  active: true,
  ...patch,
});

const scopeOf = (rules: ProxyRule[], over: Partial<Parameters<typeof resolveProxyScope>[0]> = {}) =>
  resolveProxyScope({
    rules,
    actorUserId: ACTOR,
    kind: 'leave',
    unrestricted: false,
    subordinateUserIds: new Set(['u-b']),
    snapshot: SNAPSHOT,
    directory: DIRECTORY,
    ...over,
  });
const idsOf = (scope: ReturnType<typeof scopeOf>) => [...scope.employeeIds].sort();

describe('phạm vi tạo đơn hộ (resolveProxyScope)', () => {
  it('không có cấu hình nào áp: mặc định chỉ cấp dưới theo sơ đồ tổ chức', () => {
    const scope = scopeOf([]);
    expect(scope.all).toBe(false);
    expect(idsOf(scope)).toEqual(['e-b']);
  });

  it('quyền không giới hạn thì được tạo hộ cho tất cả', () => {
    expect(scopeOf([], { unrestricted: true }).all).toBe(true);
  });

  it('SAME_UNIT: cùng đơn vị với người tạo, không gồm chính họ và đơn vị con', () => {
    expect(idsOf(scopeOf([rule({ scopeType: 'SAME_UNIT' })]))).toEqual(['e-a']);
  });

  it('UNIT_LIST: gồm cả đơn vị con của đơn vị được chọn', () => {
    expect(idsOf(scopeOf([rule({ scopeType: 'UNIT_LIST', unitIds: ['U3'] })]))).toEqual(['e-c', 'e-d']);
  });

  it('EMPLOYEE_LIST: đúng danh sách nhân viên chỉ định', () => {
    expect(idsOf(scopeOf([rule({ scopeType: 'EMPLOYEE_LIST', employeeIds: ['e-d', 'e-noacct'] })]))).toEqual(['e-d', 'e-noacct']);
  });

  it('ALL: không giới hạn', () => {
    expect(scopeOf([rule({ scopeType: 'ALL' })]).all).toBe(true);
  });

  it('nhiều cấu hình cùng áp thì lấy hợp', () => {
    const scope = scopeOf([
      rule({ id: 'r1', scopeType: 'SAME_UNIT' }),
      rule({ id: 'r2', scopeType: 'UNIT_LIST', unitIds: ['U4'] }),
    ]);
    expect(idsOf(scope)).toEqual(['e-a', 'e-d']);
  });

  it('cấu hình của loại đơn khác hoặc đã tắt không áp, quay về mặc định', () => {
    const scope = scopeOf([
      rule({ id: 'r1', requestKinds: ['ot'], scopeType: 'ALL' }),
      rule({ id: 'r2', active: false, scopeType: 'ALL' }),
    ]);
    expect(scope.all).toBe(false);
    expect(idsOf(scope)).toEqual(['e-b']);
  });

  it('cấu hình riêng cho một tài khoản không áp cho người khác', () => {
    const rules = [rule({ granteeUserId: 'someone-else', scopeType: 'ALL' })];
    expect(applicableProxyRules(rules, ACTOR, 'leave')).toHaveLength(0);
    expect(scopeOf(rules).all).toBe(false);
    expect(applicableProxyRules(rules, 'someone-else', 'leave')).toHaveLength(1);
  });

  it('không bao giờ gồm chính người tạo hộ', () => {
    const scope = scopeOf([rule({ scopeType: 'UNIT_LIST', unitIds: ['U1'] })], { subordinateUserIds: new Set() });
    expect(idsOf(scope)).toEqual(['e-a', 'e-b']);
    expect(scope.employeeIds.has('e-actor')).toBe(false);
  });

  it('unitWithDescendants đi hết cây đơn vị và chịu được vòng lặp', () => {
    const cyc: OrgSnapshotLike = { units: [{ id: 'A', parentId: 'B' }, { id: 'B', parentId: 'A' }] };
    expect([...unitWithDescendants(cyc, ['A'])].sort()).toEqual(['A', 'B']);
    expect([...unitWithDescendants(SNAPSHOT, ['U1'])].sort()).toEqual(['U1', 'U2']);
  });
});

describe('quyền tạo hộ', () => {
  it('quyền tạo hộ cơ bản chưa phải không giới hạn', () => {
    expect(canCreateBehalf(['hrm.request.create.behalf'])).toBe(true);
    expect(hasUnrestrictedProxy(['hrm.request.create.behalf'])).toBe(false);
  });

  it('quyền toàn tenant, quyền quản lý đơn cũ và quản trị đều không giới hạn', () => {
    for (const permission of ['hrm.request.create.behalf.all', 'hrm.request.manage', 'hrm.manage', 'tenant.manage'])
      expect(hasUnrestrictedProxy([permission])).toBe(true);
  });

  it('không có quyền nào thì không tạo hộ được', () => {
    expect(canCreateBehalf(['hrm.read', 'hrm.self.request'])).toBe(false);
    expect(canCreateBehalf(undefined)).toBe(false);
  });
});

describe('nội dung cấu hình và lý do', () => {
  const valid = { name: 'Trưởng phòng', requestKinds: ['leave', 'ot'], scopeType: 'SAME_UNIT' };

  it('chuẩn hoá cấu hình hợp lệ và bỏ danh sách không dùng tới', () => {
    const input = normalizeProxyRuleInput({ ...valid, unitIds: ['11111111-1111-4111-8111-111111111111'], active: false });
    expect(input).toMatchObject({ name: 'Trưởng phòng', scopeType: 'SAME_UNIT', unitIds: [], employeeIds: [], active: false, granteeUserId: null });
  });

  it('nhận giải trình công; không nhận loại ngoài danh sách', () => {
    expect(normalizeProxyRuleInput({ ...valid, requestKinds: ['correction'] }).requestKinds).toEqual(['correction']);
  });

  it('chỉ nhận nghỉ phép, tăng ca, công tác, giải trình công', () => {
    expect(() => normalizeProxyRuleInput({ ...valid, requestKinds: ['advance'] })).toThrow(BadRequestException);
    expect(() => normalizeProxyRuleInput({ ...valid, requestKinds: [] })).toThrow(BadRequestException);
    expect(() => normalizeProxyRuleInput({ ...valid, requestKinds: ['leave', 'shift_change'] })).toThrow(BadRequestException);
  });

  it('UNIT_LIST và EMPLOYEE_LIST bắt buộc có danh sách; loại phạm vi phải hợp lệ', () => {
    expect(() => normalizeProxyRuleInput({ ...valid, scopeType: 'UNIT_LIST' })).toThrow(BadRequestException);
    expect(() => normalizeProxyRuleInput({ ...valid, scopeType: 'EMPLOYEE_LIST' })).toThrow(BadRequestException);
    expect(() => normalizeProxyRuleInput({ ...valid, scopeType: 'EVERYONE' })).toThrow(BadRequestException);
    expect(() => normalizeProxyRuleInput({ ...valid, name: '  ' })).toThrow(BadRequestException);
  });

  it('lý do tạo hộ bắt buộc', () => {
    expect(() => requireProxyReason(undefined)).toThrow(BadRequestException);
    expect(() => requireProxyReason('   ')).toThrow(BadRequestException);
    expect(requireProxyReason('  Nhân viên báo ốm qua điện thoại ')).toBe('Nhân viên báo ốm qua điện thoại');
    expect(() => requireProxyReason('x'.repeat(501))).toThrow(BadRequestException);
  });

  it('onBehalfView: đơn tự gửi và đơn tạo hộ', () => {
    expect(onBehalfView({})).toEqual({ submittedBy: null, createdOnBehalf: false, onBehalfReason: null, onBehalfByName: null });
    expect(
      onBehalfView({ submitted_by: 'u1', created_on_behalf: true, on_behalf_reason: 'Báo ốm', on_behalf_by_name: 'Trưởng phòng' }),
    ).toEqual({ submittedBy: 'u1', createdOnBehalf: true, onBehalfReason: 'Báo ốm', onBehalfByName: 'Trưởng phòng' });
  });
});

type Call = { sql: string; params: unknown[] };
function fakeDb(handlers: Array<[RegExp, unknown[]]>, calls: Call[] = []) {
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = handlers.find(([pattern]) => pattern.test(sql));
      return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0 };
    },
  };
}
const directoryRows = DIRECTORY.map((e) => ({ employee_id: e.employeeId, user_id: e.userId, employee_code: e.employeeCode, full_name: e.fullName }));
const proxyService = (subordinates: string[] = ['u-b']) =>
  new HrmRequestProxyService({
    subordinateUserIds: async () => new Set(subordinates),
    orgSnapshot: async () => SNAPSHOT,
  });
const actorCtx = (permissions: string[], rules: unknown[] = []) => ({
  pool: fakeDb([
    [/to_regclass/, [{ ready: true }]],
    [/request_proxy_rules/, rules as unknown[]],
    [/FROM core_schema.employees e\s+JOIN hrm_schema.employee_profiles/, directoryRows],
  ]),
  tenantId: 't1',
  principal: { userId: ACTOR, permissions },
});

describe('HrmRequestProxyService', () => {
  it('thiếu quyền tạo hộ thì 403', async () => {
    await expect(proxyService().assertCanCreateFor(actorCtx(['hrm.self.request']), 'leave', 'e-b')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cấp dưới được phép, người ngoài phạm vi bị chặn kèm mã lỗi', async () => {
    const ctx = actorCtx(['hrm.request.create.behalf']);
    await expect(proxyService().assertCanCreateFor(ctx, 'leave', 'e-b')).resolves.toBeUndefined();
    await expect(proxyService().assertCanCreateFor(ctx, 'leave', 'e-c')).rejects.toMatchObject({
      response: { code: 'HRM_PROXY_OUT_OF_SCOPE' },
    });
  });

  it('nhân viên không tồn tại hoặc đã nghỉ việc: 404', async () => {
    await expect(proxyService().assertCanCreateFor(actorCtx(['hrm.request.create.behalf.all']), 'ot', 'e-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('quyền toàn tenant tạo hộ cho mọi người còn làm việc', async () => {
    await expect(proxyService().assertCanCreateFor(actorCtx(['hrm.request.create.behalf.all']), 'business_trip', 'e-d')).resolves.toBeUndefined();
  });

  it('cấu hình mở rộng phạm vi: người được thêm vào danh sách cũng tạo hộ được', async () => {
    const rules = [
      {
        id: 'r1',
        name: 'Thêm D',
        grantee_user_id: null,
        request_kinds: ['leave'],
        scope_type: 'EMPLOYEE_LIST',
        unit_ids: [],
        employee_ids: ['e-d'],
        active: true,
        updated_at: new Date().toISOString(),
      },
    ];
    const ctx = actorCtx(['hrm.request.create.behalf'], rules);
    await expect(proxyService().assertCanCreateFor(ctx, 'leave', 'e-d')).resolves.toBeUndefined();
    await expect(proxyService().assertCanCreateFor(ctx, 'leave', 'e-b')).rejects.toBeInstanceOf(ForbiddenException);
    // Loại đơn khác không có cấu hình riêng: dùng mặc định (cấp dưới).
    await expect(proxyService().assertCanCreateFor(ctx, 'ot', 'e-b')).resolves.toBeUndefined();
  });

  it('danh sách chọn: lọc theo phạm vi và từ khoá, không gồm chính người dùng', async () => {
    const ctx = actorCtx(['hrm.request.create.behalf.all']);
    const all = await proxyService().candidates(ctx, 'leave', '');
    expect(all.map((c) => c.employeeId)).toEqual(['e-a', 'e-b', 'e-c', 'e-d', 'e-noacct']);
    const found = await proxyService().candidates(ctx, 'leave', 'nv-c');
    expect(found.map((c) => c.employeeId)).toEqual(['e-c']);
    const scoped = await proxyService().candidates(actorCtx(['hrm.request.create.behalf']), 'leave', '');
    expect(scoped.map((c) => c.employeeId)).toEqual(['e-b']);
  });
});

describe('ghi dấu đơn tạo hộ', () => {
  it('cập nhật đơn, ghi nhật ký và phát sự kiện báo cho chủ đơn', async () => {
    const calls: Call[] = [];
    const db = fakeDb(
      [[/SELECT e\.user_id AS owner_user_id/, [{ owner_user_id: 'u-owner', owner_name: 'Chủ đơn', actor_name: 'Trưởng phòng' }]]],
      calls,
    );
    const row = await markOnBehalf(db as never, { id: 'req-1', status: 'PENDING' }, {
      tenantId: 't1',
      table: 'leave_requests',
      kind: 'leave',
      employeeId: 'e-owner',
      actorUserId: ACTOR,
      reason: 'Nhân viên báo ốm qua điện thoại',
    });
    expect(row).toMatchObject({ created_on_behalf: true, submitted_by: ACTOR, on_behalf_by_name: 'Trưởng phòng' });
    const update = calls.find((c) => /UPDATE hrm_schema\.leave_requests/.test(c.sql));
    expect(update?.params).toEqual(['t1', 'req-1', ACTOR, 'Nhân viên báo ốm qua điện thoại', 'Trưởng phòng']);
    expect(calls.some((c) => /REQUEST_CREATE_ON_BEHALF/.test(c.sql))).toBe(true);
    const outbox = calls.find((c) => /outbox_events/.test(c.sql));
    expect(outbox?.params[2]).toBe('hrm.request.created-on-behalf');
    expect(JSON.parse(String(outbox?.params[4])).payload.recipientUserIds).toEqual(['u-owner']);
  });

  it('giải trình công: ghi dấu vào đúng bảng attendance_corrections và báo cho chủ đơn', async () => {
    const calls: Call[] = [];
    const db = fakeDb([[/SELECT e.user_id AS owner_user_id/, [{ owner_user_id: 'u-owner', owner_name: 'Chủ đơn', actor_name: 'Nhân sự' }]]], calls);
    const row = await markOnBehalf(db as never, { id: 'corr-1' }, {
      tenantId: 't1',
      table: 'attendance_corrections',
      kind: 'correction',
      employeeId: 'e-owner',
      actorUserId: ACTOR,
      reason: 'Nhân viên quên chấm công, báo qua điện thoại',
    });
    expect(row).toMatchObject({ created_on_behalf: true, on_behalf_by_name: 'Nhân sự' });
    expect(calls.some((c) => /UPDATE hrm_schema.attendance_corrections/.test(c.sql))).toBe(true);
    const outbox = calls.find((c) => /outbox_events/.test(c.sql));
    expect(JSON.parse(String(outbox?.params[4])).payload.summary).toContain('giải trình công');
  });

  it('chủ đơn không có tài khoản thì không phát sự kiện', async () => {
    const calls: Call[] = [];
    const db = fakeDb([[/SELECT e\.user_id AS owner_user_id/, [{ owner_user_id: null, owner_name: 'Chủ đơn', actor_name: 'Trưởng phòng' }]]], calls);
    await markOnBehalf(db as never, { id: 'req-2' }, {
      tenantId: 't1',
      table: 'ot_requests',
      kind: 'ot',
      employeeId: 'e-owner',
      actorUserId: ACTOR,
      reason: 'Báo qua điện thoại',
    });
    expect(calls.some((c) => /outbox_events/.test(c.sql))).toBe(false);
  });
});
