import {
  HrmApprovalPolicyService,
  approvalKindOfPermissions,
  approvalScopeSql,
  assignedKindsWithoutPermission,
  procedureActionableRequestIds,
  resolveApprovalScope,
  type HrmOrgScopePort,
} from './hrm-approval-policy.js';
import { fetchActionableProcedureInstanceIds } from './hrm-procedure-api.js';

jest.mock('./hrm-procedure-api.js', () => ({
  fetchActionableProcedureInstanceIds: jest.fn(),
}));
const fetchActionable = fetchActionableProcedureInstanceIds as jest.MockedFunction<
  typeof fetchActionableProcedureInstanceIds
>;

const TENANT = 'tenant-1';
const BACKUP = 'user-backup';

/** Đơn nghỉ đang chạy qua PE: mã đơn -> mã hồ sơ PE. */
function dbWith(candidates: { request_id: string; instance_id: string }[]) {
  const calls: string[] = [];
  return {
    calls,
    db: {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('to_regclass')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }], rowCount: 1 };
        if (sql.includes('procedure_links')) return { rows: candidates, rowCount: candidates.length };
        return { rows: [], rowCount: 0 };
      },
    } as never,
  };
}

const orgScope = (subordinates: string[] = []): HrmOrgScopePort => ({
  subordinateUserIds: async () => new Set(subordinates),
});

beforeEach(() => fetchActionable.mockReset());

describe('procedureActionableRequestIds: đơn PE giao cho người này', () => {
  it('đổi mã hồ sơ PE mà PE nói người này xử lý được thành mã đơn HRM', async () => {
    fetchActionable.mockResolvedValue(['inst-2']);
    const { db } = dbWith([
      { request_id: 'req-1', instance_id: 'inst-1' },
      { request_id: 'req-2', instance_id: 'inst-2' },
    ]);
    await expect(procedureActionableRequestIds(db, TENANT, 'leave', BACKUP)).resolves.toEqual(['req-2']);
    expect(fetchActionable).toHaveBeenCalledWith(TENANT, BACKUP, ['inst-1', 'inst-2']);
  });

  it('không có đơn nào đang chạy qua PE thì không gọi PE', async () => {
    const { db } = dbWith([]);
    await expect(procedureActionableRequestIds(db, TENANT, 'leave', BACKUP)).resolves.toEqual([]);
    expect(fetchActionable).not.toHaveBeenCalled();
  });

  it('chia lô 100 hồ sơ mỗi lần hỏi PE', async () => {
    fetchActionable.mockResolvedValue([]);
    const many = Array.from({ length: 230 }, (_, index) => ({ request_id: `r${index}`, instance_id: `i${index}` }));
    const { db } = dbWith(many);
    await procedureActionableRequestIds(db, TENANT, 'leave', BACKUP);
    expect(fetchActionable.mock.calls.map((call) => call[2].length)).toEqual([100, 100, 30]);
  });

  it('PE không trả lời thì bỏ qua, không làm hỏng danh sách', async () => {
    fetchActionable.mockRejectedValue(new Error('Procedure tắt'));
    const { db } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    await expect(procedureActionableRequestIds(db, TENANT, 'leave', BACKUP)).resolves.toEqual([]);
  });

  it('chỉ xét bản liên kết mới nhất đang RUNNING của đúng loại đơn', async () => {
    fetchActionable.mockResolvedValue([]);
    const { db, calls } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    await procedureActionableRequestIds(db, TENANT, 'ot', BACKUP);
    const sql = calls.find((item) => item.includes('procedure_links')) ?? '';
    expect(sql).toContain('DISTINCT ON (request_id)');
    expect(sql).toContain('revision DESC');
    expect(sql).toContain("sync_status = 'RUNNING'");
  });
});

describe('resolveApprovalScope: thêm đơn PE vào phạm vi duyệt', () => {
  it('người dự phòng không có cấp dưới vẫn thấy đơn PE giao cho mình', async () => {
    fetchActionable.mockResolvedValue(['inst-1']);
    const { db } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    const scope = await resolveApprovalScope(
      { userId: BACKUP, permissions: ['hrm.leave.approve'] },
      'leave',
      { db, tenantId: TENANT, orgScope: orgScope([]) },
    );
    expect(scope).toMatchObject({ all: false, userIds: [], requestIds: ['req-1'], excludeUserId: BACKUP });
  });

  it('người duyệt toàn tenant không cần hỏi PE', async () => {
    const { db } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    const scope = await resolveApprovalScope(
      { userId: BACKUP, permissions: ['hrm.leave.approve.all'] },
      'leave',
      { db, tenantId: TENANT, orgScope: orgScope([]) },
    );
    expect(scope.all).toBe(true);
    expect(fetchActionable).not.toHaveBeenCalled();
  });
});

describe('approvalScopeSql với đơn PE giao riêng', () => {
  it('cấp dưới HOẶC đơn PE giao cho mình, rồi mới loại đơn của chính mình', () => {
    const out = approvalScopeSql(
      { all: false, userIds: ['a'], requestIds: ['req-1'], excludeUserId: BACKUP },
      'r',
      3,
    );
    expect(out.params).toEqual([['a'], ['req-1'], BACKUP]);
    expect(out.sql).toContain('ANY($3::uuid[])');
    expect(out.sql).toContain('OR r.id = ANY($4::uuid[])');
    expect(out.sql).toContain('$5::uuid');
    // Điều kiện phạm vi nằm trong ngoặc để phép OR không "nuốt" điều kiện loại đơn của chính mình.
    expect(out.sql).toMatch(/^\(.*OR r\.id = ANY\(\$4::uuid\[\]\)\) AND NOT EXISTS/s);
  });

  it('không có đơn PE giao riêng thì giữ nguyên câu lệnh cũ', () => {
    const out = approvalScopeSql({ all: false, userIds: ['a'], requestIds: [], excludeUserId: null }, 'r', 2);
    expect(out.params).toEqual([['a']]);
    expect(out.sql).not.toContain('OR r.id');
  });
});

/** Cơ sở dữ liệu giả: chỉ đơn loại `kind` đang chạy PE; các loại khác không có đơn nào. */
function dbOnlyKind(kind: string, candidates: { request_id: string; instance_id: string }[]) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('to_regclass')) return { rows: [{ ready: true }], rowCount: 1 };
      if (sql.includes('approval_policy_settings')) return { rows: [{ allow_self_approval: false }], rowCount: 1 };
      if (sql.includes('procedure_links')) {
        const rows = params[1] === kind ? candidates : [];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as never;
}

describe('người được giao nhưng không có quyền duyệt của HRM', () => {
  it('resolveApprovalScope: chỉ thấy đơn được giao, không thấy đơn của cấp dưới', async () => {
    fetchActionable.mockResolvedValue(['inst-1']);
    const { db } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    const subordinateUserIds = jest.fn(async () => new Set(['cap-duoi']));
    const scope = await resolveApprovalScope(
      { userId: BACKUP, permissions: ['hrm.read', 'hrm.self.read'] },
      'leave',
      { db, tenantId: TENANT, orgScope: { subordinateUserIds } },
    );
    expect(scope).toMatchObject({ all: false, userIds: [], requestIds: ['req-1'], excludeUserId: BACKUP });
    expect(subordinateUserIds).not.toHaveBeenCalled();
  });

  it('có quyền duyệt trong phạm vi thì vẫn thấy cấp dưới như trước', async () => {
    fetchActionable.mockResolvedValue([]);
    const { db } = dbWith([]);
    const scope = await resolveApprovalScope(
      { userId: BACKUP, permissions: ['hrm.leave.approve'] },
      'leave',
      { db, tenantId: TENANT, orgScope: orgScope(['cap-duoi']) },
    );
    expect(scope.userIds).toContain('cap-duoi');
  });

  it('assignedKindsWithoutPermission: chỉ trả loại đơn đang được giao và người này chưa có quyền duyệt', async () => {
    fetchActionable.mockResolvedValue(['inst-1']);
    const db = dbOnlyKind('leave', [{ request_id: 'req-1', instance_id: 'inst-1' }]);
    await expect(
      assignedKindsWithoutPermission(db, TENANT, { userId: BACKUP, permissions: ['hrm.read'] }),
    ).resolves.toEqual(['leave']);
    // Đã có quyền duyệt đơn nghỉ thì không cần cấp thêm.
    await expect(
      assignedKindsWithoutPermission(db, TENANT, { userId: BACKUP, permissions: ['hrm.read', 'hrm.leave.approve'] }),
    ).resolves.toEqual([]);
  });

  it('assignedKindsWithoutPermission: PE không trả lời thì coi như không có, không làm hỏng', async () => {
    fetchActionable.mockRejectedValue(new Error('Procedure tắt'));
    const db = dbOnlyKind('leave', [{ request_id: 'req-1', instance_id: 'inst-1' }]);
    await expect(
      assignedKindsWithoutPermission(db, TENANT, { userId: BACKUP, permissions: ['hrm.read'] }),
    ).resolves.toEqual([]);
  });

  it('approvalKindOfPermissions: đoán loại đơn từ bộ quyền duyệt', () => {
    expect(approvalKindOfPermissions(['hrm.leave.approve', 'hrm.leave.approve.all'])).toBe('leave');
    expect(approvalKindOfPermissions(['hrm.trip.approve', 'hrm.trip.approve.all'])).toBe('business_trip');
    expect(approvalKindOfPermissions([])).toBeUndefined();
  });
});

describe('HrmApprovalPolicyService.listFilter: người không có quyền duyệt HRM', () => {
  const service = new HrmApprovalPolicyService(orgScope([]));

  it('được giao đơn thì danh sách chờ duyệt chỉ gồm các đơn đó, không phải TRUE (không lộ đơn người khác)', async () => {
    fetchActionable.mockResolvedValue(['inst-1']);
    const { db } = dbWith([{ request_id: 'req-1', instance_id: 'inst-1' }]);
    const filter = await service.listFilter(
      { pool: db, tenantId: TENANT, principal: { userId: BACKUP, permissions: ['hrm.read'] } },
      'leave',
      'lr',
      4,
    );
    expect(filter.sql).not.toBe('TRUE');
    expect(filter.sql).toContain('lr.id = ANY($5::uuid[])');
    expect(filter.params).toEqual([[], ['req-1'], BACKUP]);
  });

  it('không được giao đơn nào thì giữ như cũ (đã bị giới hạn vào đơn của chính mình ở bước đọc)', async () => {
    fetchActionable.mockResolvedValue([]);
    const { db } = dbWith([]);
    const filter = await service.listFilter(
      { pool: db, tenantId: TENANT, principal: { userId: BACKUP, permissions: ['hrm.read'] } },
      'leave',
      'lr',
      4,
    );
    expect(filter).toEqual({ sql: 'TRUE', params: [] });
  });
});
