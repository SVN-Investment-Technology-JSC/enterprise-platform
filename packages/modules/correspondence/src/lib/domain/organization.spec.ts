import { memberUnits, unitHeads, unitMembers, type OrganizationSnapshot } from './organization.js';

/** Phòng Kinh doanh nằm dưới Ban Tổng Giám đốc trong sơ đồ; tổ bán hàng là chức danh con của trưởng phòng. */
const snapshot: OrganizationSnapshot = {
  nodes: [
    { id: 'company', name: 'Công ty', kind: 'unit' },
    { id: 'board', name: 'Ban Tổng Giám đốc', parentId: 'company', kind: 'unit' },
    { id: 'pos-ceo', name: 'Tổng Giám đốc', parentId: 'board', kind: 'position' },
    { id: 'pos-assistant', name: 'Trợ lý', parentId: 'board', kind: 'position' },
    { id: 'sales', name: 'Phòng Kinh doanh', parentId: 'board', kind: 'unit' },
    { id: 'pos-sales-head', name: 'Trưởng phòng Kinh doanh', parentId: 'sales', kind: 'position' },
    { id: 'pos-sales-lead', name: 'Trưởng nhóm bán hàng', parentId: 'pos-sales-head', kind: 'position' },
    { id: 'pos-sales', name: 'Chuyên viên kinh doanh', parentId: 'sales', kind: 'position' },
  ],
  members: [
    { userId: 'u-ceo', name: 'Hà Nguyên Hoàng', nodeId: 'pos-ceo', positionName: 'Tổng Giám đốc', isHead: true },
    { userId: 'u-assistant', name: 'Lê Thu Hà', nodeId: 'pos-assistant', positionName: 'Trợ lý', isHead: false },
    { userId: 'u-sales-head', name: 'Bùi Hiếu Văn', nodeId: 'pos-sales-head', positionName: 'Trưởng phòng Kinh doanh', isHead: true },
    { userId: 'u-lead', name: 'Bùi Duy Khánh', nodeId: 'pos-sales-lead', positionName: 'Trưởng nhóm bán hàng', isHead: false },
    { userId: 'u-sales', name: 'Bùi Công Quyền', nodeId: 'pos-sales', positionName: 'Chuyên viên kinh doanh', isHead: false },
  ],
  degraded: false,
};

describe('Nhân sự theo phòng ban', () => {
  it('nhân sự của một phòng chỉ gồm người thuộc chính phòng đó, không gồm người của phòng con', () => {
    expect(unitMembers(snapshot, 'board').map((member) => member.userId)).toEqual(['u-ceo', 'u-assistant']);
    expect(unitMembers(snapshot, 'sales').map((member) => [member.userId, member.isHead])).toEqual([
      ['u-sales-head', true],
      ['u-sales', false],
      ['u-lead', false],
    ]);
    expect(unitMembers(snapshot, 'company')).toEqual([]);
  });

  it('người dùng chỉ thuộc đơn vị trực tiếp chứa chức danh của mình, không thuộc các đơn vị cha', () => {
    expect([...memberUnits(snapshot, 'u-sales')]).toEqual(['sales']);
    expect([...memberUnits(snapshot, 'u-lead')]).toEqual(['sales']);
    expect([...memberUnits(snapshot, 'u-ceo')]).toEqual(['board']);
    expect(memberUnits(snapshot, 'u-nobody').size).toBe(0);
  });

  it('trưởng đơn vị không đổi: phòng chưa có trưởng thì lên đơn vị cha', () => {
    expect(unitHeads(snapshot, 'sales')).toEqual(['u-sales-head']);
    expect(unitHeads(snapshot, 'board')).toEqual(['u-ceo']);
    expect(unitHeads(snapshot, 'company')).toEqual([]);
  });
});
