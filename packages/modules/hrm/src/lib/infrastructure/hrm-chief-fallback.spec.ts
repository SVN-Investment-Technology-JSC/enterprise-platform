import {
  chiefFallbackUserIds,
  chiefFor,
  employeesWithoutManager,
  findChiefs,
  isChiefPositionName,
  type OrgFacts,
  type OrgHolder,
} from './hrm-chief-fallback.js';

const holder = (employeeId: string, positionId: string, extra: Partial<OrgHolder> = {}): OrgHolder => ({
  positionId,
  isPrimary: true,
  overrideId: null,
  employeeId,
  userId: `u-${employeeId}`,
  name: employeeId,
  email: null,
  code: null,
  inactive: false,
  ...extra,
});

/** CEO <- Trưởng phòng <- Nhân viên; "Lễ tân" chưa khai báo "Báo cáo cho". */
function facts(overrides: Partial<OrgFacts> = {}): OrgFacts {
  return {
    positions: [
      { id: 'p-ceo', name: 'Tổng Giám đốc', reportsToId: null },
      { id: 'p-vice', name: 'Phó Tổng Giám đốc', reportsToId: 'p-ceo' },
      { id: 'p-head', name: 'Trưởng phòng', reportsToId: 'p-ceo' },
      { id: 'p-staff', name: 'Nhân viên', reportsToId: 'p-head' },
      { id: 'p-front', name: 'Lễ tân', reportsToId: null },
    ],
    holders: [
      holder('ceo', 'p-ceo'),
      holder('vice', 'p-vice'),
      holder('head', 'p-head'),
      holder('staff', 'p-staff'),
      holder('front', 'p-front'),
    ],
    employees: ['ceo', 'vice', 'head', 'staff', 'front'].map((id) => ({
      employeeId: id,
      userId: `u-${id}`,
      inactive: false,
    })),
    ...overrides,
  };
}

describe('isChiefPositionName', () => {
  it('nhận Tổng giám đốc, kể cả chức danh kiêm nhiệm, và loại Phó Tổng giám đốc', () => {
    expect(isChiefPositionName('Tổng Giám đốc')).toBe(true);
    expect(isChiefPositionName('Chủ tịch Hội đồng Quản trị, Tổng Giám đốc')).toBe(true);
    expect(isChiefPositionName('Phó Tổng Giám đốc')).toBe(false);
    expect(isChiefPositionName('Giám đốc Kỹ thuật')).toBe(false);
  });
});

describe('employeesWithoutManager', () => {
  it('chỉ trả người không có Báo cáo cho dẫn tới người giữ chức danh ', () => {
    const ids = employeesWithoutManager(facts()).map((e) => e.employeeId);
    // "vice" báo cáo cho p-ceo (có người giữ); "front" không khai báo; "ceo" là gốc cây.
    expect(ids.sort()).toEqual(['ceo', 'front']);
  });

  it('chức danh cấp trên trống thì leo tiếp; không còn ai thì tính là chưa có quản lý', () => {
    const emptyHead = facts({ holders: facts().holders.filter((h) => h.employeeId !== 'head') });
    expect(employeesWithoutManager(emptyHead).map((e) => e.employeeId)).not.toContain('staff');
    const noOneAbove = facts({ holders: facts().holders.filter((h) => !['head', 'ceo'].includes(h.employeeId)) });
    expect(employeesWithoutManager(noOneAbove).map((e) => e.employeeId)).toContain('staff');
  });

  it('người giữ cấp trên đã nghỉ việc không được tính là quản lý', () => {
    const resigned = facts({
      holders: facts().holders.map((h) => (['head', 'ceo'].includes(h.employeeId) ? { ...h, inactive: true } : h)),
    });
    expect(employeesWithoutManager(resigned).map((e) => e.employeeId)).toContain('staff');
  });

  it('ô ghi đè trên phân công thắng Báo cáo cho của chức danh', () => {
    const overridden = facts({
      holders: facts().holders.map((h) => (h.employeeId === 'front' ? { ...h, overrideId: 'p-head' } : h)),
    });
    expect(employeesWithoutManager(overridden).map((e) => e.employeeId)).not.toContain('front');
  });

  it('nhân viên chưa có phân công nào cũng chưa có quản lý; nhân viên đã nghỉ thì bỏ qua', () => {
    const extra = facts({
      employees: [
        ...facts().employees,
        { employeeId: 'new', userId: 'u-new', inactive: false },
        { employeeId: 'gone', userId: 'u-gone', inactive: true },
      ],
    });
    const ids = employeesWithoutManager(extra).map((e) => e.employeeId);
    expect(ids).toContain('new');
    expect(ids).not.toContain('gone');
  });
});

describe('chiefFor / findChiefs', () => {
  it('Tổng giám đốc không tự là quản lý của chính mình', () => {
    expect(chiefFor(facts(), 'front')?.employeeId).toBe('ceo');
    expect(chiefFor(facts(), 'ceo')).toBeNull();
  });

  it('có hai Tổng giám đốc thì mỗi người là người duyệt dự phòng của người kia', () => {
    const two = facts({
      holders: [...facts().holders, holder('ceo2', 'p-ceo', { isPrimary: false })],
    });
    expect(findChiefs(two).map((c) => c.employeeId)).toEqual(['ceo', 'ceo2']);
    expect(chiefFor(two, 'ceo')?.employeeId).toBe('ceo2');
  });
});

describe('chiefFallbackUserIds', () => {
  it('lỗi đọc dữ liệu không mở rộng phạm vi', async () => {
    const db = { query: async () => Promise.reject(new Error('boom')) } as never;
    expect((await chiefFallbackUserIds(db, 'tenant', 'u-ceo')).size).toBe(0);
  });

  it('dữ liệu sai hình dạng (không có Tổng giám đốc) cho phạm vi rỗng', async () => {
    const db = { query: async () => ({ rows: [{ employee_id: 'x', user_id: 'y' }], rowCount: 1 }) } as never;
    expect((await chiefFallbackUserIds(db, 'tenant', 'y')).size).toBe(0);
  });
});
