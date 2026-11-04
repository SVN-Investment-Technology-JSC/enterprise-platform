import { pendingDirectApproverNames } from './hrm-direct-approver-names.js';

const mockCandidates = jest.fn();
const mockBindings = jest.fn();
const mockFacts = jest.fn();

jest.mock('./hrm-approval-policy.js', () => ({
  ...jest.requireActual('./hrm-approval-policy.js'),
  loadDirectCandidates: (...args: unknown[]) => mockCandidates(...args),
  loadBindingRows: (...args: unknown[]) => mockBindings(...args),
}));
jest.mock('./hrm-chief-fallback.js', () => ({
  ...jest.requireActual('./hrm-chief-fallback.js'),
  loadOrgFacts: (...args: unknown[]) => mockFacts(...args),
}));

const holder = (positionId: string, employeeId: string, name: string, extra: object = {}) => ({
  positionId, isPrimary: true, employeeId, userId: `u-${employeeId}`, name, inactive: false, ...extra,
});

const facts = {
  positions: [
    { id: 'p-nv', name: 'Nhân viên thí nghiệm', reportsToId: 'p-pho' },
    { id: 'p-pho', name: 'Phó Trưởng phòng', reportsToId: 'p-tp' },
    { id: 'p-tp', name: 'Trưởng phòng', reportsToId: null },
  ],
  holders: [
    holder('p-nv', 'e-quyen', 'Bùi Công Quyền'),
    holder('p-pho', 'e-binh', 'Trần Quang Bình'),
    holder('p-tp', 'e-thinh', 'Nguyễn Tấn Thịnh'),
  ],
  employees: [],
};

describe('pendingDirectApproverNames', () => {
  beforeEach(() => {
    mockFacts.mockResolvedValue(facts);
    mockCandidates.mockResolvedValue([{ id: 'r1', employee_id: 'e-quyen', created_at: null, sub_type_code: null }]);
    mockBindings.mockResolvedValue([]);
  });
  afterEach(() => jest.clearAllMocks());

  it('nguồn quản lý trực tiếp: tên người giữ chức danh cấp trên gần nhất', async () => {
    const result = await pendingDirectApproverNames({ query: jest.fn() } as never, 't', 'leave');
    expect(result).toEqual([{ requestId: 'r1', employeeId: 'e-quyen', names: ['Trần Quang Bình'] }]);
  });

  it('nguồn chức danh chỉ định: người giữ chức danh đó, không phải quản lý trực tiếp', async () => {
    mockBindings.mockResolvedValue([
      { sub_type_code: null, mode: 'DIRECT', fallback_position_id: null, direct_approver_source: 'POSITION', approver_position_id: 'p-tp' },
    ]);
    const result = await pendingDirectApproverNames({ query: jest.fn() } as never, 't', 'leave');
    expect(result[0].names).toEqual(['Nguyễn Tấn Thịnh']);
  });

  it('đơn đi theo quy trình (PROCEDURE) không có trong kết quả', async () => {
    mockBindings.mockResolvedValue([
      { sub_type_code: null, mode: 'PROCEDURE', fallback_position_id: null, direct_approver_source: null, approver_position_id: null },
    ]);
    expect(await pendingDirectApproverNames({ query: jest.fn() } as never, 't', 'leave')).toEqual([]);
  });

  it('người cấp trên đã nghỉ việc thì bỏ qua, lên cấp kế tiếp', async () => {
    mockFacts.mockResolvedValue({ ...facts, holders: [facts.holders[0], holder('p-pho', 'e-binh', 'Trần Quang Bình', { inactive: true }), facts.holders[2]] });
    const result = await pendingDirectApproverNames({ query: jest.fn() } as never, 't', 'leave');
    expect(result[0].names).toEqual(['Nguyễn Tấn Thịnh']);
  });
});
