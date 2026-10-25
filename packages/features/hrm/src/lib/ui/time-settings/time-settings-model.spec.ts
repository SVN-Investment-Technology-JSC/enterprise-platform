import {
  buildUnitTree,
  normalizeMarks,
  toggleUnit,
  treeKeys,
  unitCovered,
  describeAssignments,
  descendantUnitIds,
  filterSites,
  ipSummary,
  parseIpText,
  tenantHasAssignments,
  type SiteRow,
  type UnitMarks,
  type UnitOption,
} from './time-settings-model';

const site = (extra: Partial<SiteRow> = {}): SiteRow => ({
  id: 's1',
  name: 'Văn phòng Hà Nội',
  latitude: 21,
  longitude: 105,
  radius_meters: 100,
  active: true,
  updated_at: '2026-10-01T00:00:00.000Z',
  ...extra,
});

describe('parseIpText', () => {
  it('tách theo dòng, dấu phẩy, chấm phẩy và khoảng trắng; bỏ ô trống và trùng', () => {
    expect(parseIpText('1.1.1.1\n2.2.2.0/24, 1.1.1.1;  3.3.3.3\n\n')).toEqual(['1.1.1.1', '2.2.2.0/24', '3.3.3.3']);
    expect(parseIpText('   ')).toEqual([]);
  });
});

describe('ipSummary', () => {
  it('không khai báo thì ghi rõ không kiểm IP; nhiều IP thì rút gọn', () => {
    expect(ipSummary(undefined)).toBe('Không kiểm IP');
    expect(ipSummary([])).toBe('Không kiểm IP');
    expect(ipSummary(['1.1.1.1', '2.2.2.2'])).toBe('1.1.1.1, 2.2.2.2');
    expect(ipSummary(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'])).toBe('1.1.1.1, 2.2.2.2 +2');
  });
});

describe('describeAssignments', () => {
  it('chưa ai được gán: nói rõ mọi nhân viên dùng được nếu cả tenant chưa gán, ngược lại là chưa gán cho ai', () => {
    expect(describeAssignments(site(), false)).toBe('Mọi nhân viên (chưa gán riêng)');
    expect(describeAssignments(site(), true)).toBe('Chưa gán cho ai');
  });

  it('toàn công ty, phòng ban kèm ghi chú kế thừa, chức danh và nhân viên', () => {
    expect(describeAssignments(site({ assignments: [{ scope_type: 'COMPANY', scope_id: 't' }] }), true)).toBe('Toàn công ty');
    expect(
      describeAssignments(
        site({
          assignments: [
            { scope_type: 'UNIT', scope_id: 'u1', scope_name: 'Khối A' },
            { scope_type: 'UNIT', scope_id: 'u2', scope_name: 'Khối B' },
            { scope_type: 'UNIT', scope_id: 'u3', scope_name: 'Khối C' },
            { scope_type: 'POSITION', scope_id: 'p1' },
            { scope_type: 'EMPLOYEE', scope_id: 'e1' },
          ],
        }),
        true,
      ),
    ).toBe('Khối A, Khối B +1 (gồm đơn vị con); 1 chức danh; 1 nhân viên');
  });

  it('ngoại lệ được nêu rõ: toàn công ty trừ, hoặc đơn vị gán trừ', () => {
    expect(
      describeAssignments(
        site({
          assignments: [
            { scope_type: 'COMPANY', scope_id: 't' },
            { scope_type: 'UNIT_EXCLUDE', scope_id: 'u1', scope_name: 'Khối A' },
          ],
        }),
        true,
      ),
    ).toBe('Toàn công ty, trừ Khối A');
    expect(
      describeAssignments(
        site({
          assignments: [
            { scope_type: 'UNIT', scope_id: 'u1', scope_name: 'Khối A' },
            { scope_type: 'UNIT_EXCLUDE', scope_id: 'u2', scope_name: 'Phòng A1' },
          ],
        }),
        true,
      ),
    ).toBe('Khối A (gồm đơn vị con, trừ Phòng A1)');
  });
});

describe('tenantHasAssignments', () => {
  it('chỉ true khi có ít nhất một phân công ở bất kỳ địa điểm nào', () => {
    expect(tenantHasAssignments([site(), site({ id: 's2' })])).toBe(false);
    expect(tenantHasAssignments([site(), site({ id: 's2', assignments: [{ scope_type: 'COMPANY', scope_id: 't' }] })])).toBe(true);
  });
});

describe('descendantUnitIds', () => {
  const units: UnitOption[] = [
    { id: 'root', parentId: null, code: 'R', name: 'Gốc' },
    { id: 'a', parentId: 'root', code: 'A', name: 'A' },
    { id: 'a1', parentId: 'a', code: 'A1', name: 'A1' },
    { id: 'b', parentId: 'root', code: 'B', name: 'B' },
  ];
  it('gồm chính đơn vị và mọi đơn vị con, cháu', () => {
    expect(descendantUnitIds(units, 'a').sort()).toEqual(['a', 'a1']);
    expect(descendantUnitIds(units, 'root').sort()).toEqual(['a', 'a1', 'b', 'root']);
    expect(descendantUnitIds(units, 'b')).toEqual(['b']);
  });

  it('chu trình trong dữ liệu không làm lặp vô hạn', () => {
    const cyc: UnitOption[] = [
      { id: 'x', parentId: 'y', code: 'X', name: 'X' },
      { id: 'y', parentId: 'x', code: 'Y', name: 'Y' },
    ];
    expect(descendantUnitIds(cyc, 'x').sort()).toEqual(['x', 'y']);
  });
});

describe('chọn phòng ban theo cây, có ngoại lệ', () => {
  const units: UnitOption[] = [
    { id: 'root', parentId: null, code: 'R', name: 'Gốc' },
    { id: 'a', parentId: 'root', code: 'A', name: 'Khối A' },
    { id: 'a1', parentId: 'a', code: 'A1', name: 'Phòng A1' },
    { id: 'a2', parentId: 'a', code: 'A2', name: 'Phòng A2' },
    { id: 'b', parentId: 'root', code: 'B', name: 'Khối B' },
  ];
  const none: UnitMarks = { companyWide: false, unitIds: [], excludedUnitIds: [] };
  const covered = (marks: UnitMarks) => units.filter((u) => unitCovered(units, marks, u.id)).map((u) => u.id);

  it('unitCovered: dấu gần nhất đi lên cây quyết định, không có dấu thì theo toàn công ty', () => {
    expect(covered(none)).toEqual([]);
    expect(covered({ ...none, companyWide: true })).toHaveLength(5);
    expect(covered({ ...none, unitIds: ['a'] })).toEqual(['a', 'a1', 'a2']);
    expect(covered({ ...none, unitIds: ['a'], excludedUnitIds: ['a1'] })).toEqual(['a', 'a2']);
    expect(covered({ companyWide: true, unitIds: [], excludedUnitIds: ['a'] })).toEqual(['root', 'b']);
    expect(covered({ companyWide: true, unitIds: ['a1'], excludedUnitIds: ['a'] })).toEqual(['root', 'a1', 'b']);
  });

  it('toggleUnit: tick cha áp cả nhánh con và xóa ngoại lệ bên dưới', () => {
    const next = toggleUnit(units, { ...none, unitIds: ['a'], excludedUnitIds: ['a1'] }, 'a', true);
    expect(next).toEqual({ companyWide: false, unitIds: ['a'], excludedUnitIds: [] });
    expect(covered(next)).toEqual(['a', 'a1', 'a2']);
  });

  it('toggleUnit: bỏ tick một đơn vị con dưới cha đã tick tạo ngoại lệ; tick lại thì mất ngoại lệ', () => {
    const marks = toggleUnit(units, none, 'a', true);
    const except = toggleUnit(units, marks, 'a1', false);
    expect(except).toEqual({ companyWide: false, unitIds: ['a'], excludedUnitIds: ['a1'] });
    expect(toggleUnit(units, except, 'a1', true)).toEqual({ companyWide: false, unitIds: ['a'], excludedUnitIds: [] });
  });

  it('toggleUnit: tick con khi cha chưa tick chỉ gán con; bỏ tick cha đang tick thì xóa dấu, không tạo ngoại lệ thừa', () => {
    expect(toggleUnit(units, none, 'a1', true)).toEqual({ companyWide: false, unitIds: ['a1'], excludedUnitIds: [] });
    expect(toggleUnit(units, { ...none, unitIds: ['a'] }, 'a', false)).toEqual(none);
  });

  it('toggleUnit: dưới toàn công ty, bỏ tick một đơn vị tạo ngoại lệ', () => {
    expect(toggleUnit(units, { ...none, companyWide: true }, 'b', false)).toEqual({
      companyWide: true,
      unitIds: [],
      excludedUnitIds: ['b'],
    });
  });

  it('normalizeMarks: bỏ dấu thừa nhưng giữ kết quả từng đơn vị; bỏ đơn vị không còn tồn tại', () => {
    const messy: UnitMarks = { companyWide: false, unitIds: ['a', 'a1', 'gone'], excludedUnitIds: ['b'] };
    const clean = normalizeMarks(units, messy);
    expect(clean).toEqual({ companyWide: false, unitIds: ['a'], excludedUnitIds: [] });
    expect(covered(clean)).toEqual(covered({ ...messy, unitIds: ['a', 'a1'] }));
    const company = normalizeMarks(units, { companyWide: true, unitIds: ['a'], excludedUnitIds: ['a1'] });
    expect(company).toEqual({ companyWide: true, unitIds: [], excludedUnitIds: ['a1'] });
  });

  it('buildUnitTree: dựng cây theo đơn vị cha; tìm kiếm giữ nhánh khớp kèm đơn vị cha', () => {
    const tree = buildUnitTree(units);
    expect(tree.map((n) => n.key)).toEqual(['root']);
    expect(treeKeys(tree)).toEqual(['root', 'a', 'a1', 'a2', 'b']);
    expect(tree[0].children[0].title).toBe('Khối A (A)');
    expect(treeKeys(buildUnitTree(units, 'a2'))).toEqual(['root', 'a', 'a2']);
    expect(buildUnitTree(units, 'không có')).toEqual([]);
  });
});

describe('filterSites', () => {
  it('tìm theo tên, tọa độ hoặc IP và lọc theo trạng thái', () => {
    const rows = [site({ allowed_ips: ['203.0.113.0/24'] }), site({ id: 's2', name: 'Kho', active: false })];
    expect(filterSites(rows, '203.0.113', 'ALL').map((r) => r.id)).toEqual(['s1']);
    expect(filterSites(rows, 'kho', 'ALL').map((r) => r.id)).toEqual(['s2']);
    expect(filterSites(rows, '', 'INACTIVE').map((r) => r.id)).toEqual(['s2']);
    expect(filterSites(rows, '', 'ACTIVE').map((r) => r.id)).toEqual(['s1']);
  });
});
