import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { buildHeaderTree, flattenColumns, pruneEmpty, treeDepth } from './columns';

/**
 * Fixture tổ chức phân cấp đa tầng:
 * - Gốc: Công ty SAVINA
 *   - Phòng Kế toán (L1, sortOrder: 1):
 *     - Kế toán trưởng (pos-3, Quản lý chính - headPositionId)
 *     - Chuyên viên tài chính (pos-1, thường)
 *     - Nhân viên kế toán (pos-2, thường)
 *   - Phòng Kỹ thuật (L1, sortOrder: 2):
 *     - Trưởng phòng Kỹ thuật (pos-9, Quản lý chính - headPositionId)
 *     - Kỹ sư điện (pos-4, thường)
 *     - Kỹ sư cơ khí (pos-5, thường)
 *     - Tổ Thí nghiệm (L2, con của Phòng Kỹ thuật):
 *       - Tổ trưởng (pos-11, Quản lý chính - headPositionId)
 *       - Kỹ thuật viên A (pos-10, thường)
 *       - Kỹ thuật viên B (pos-12, thường)
 *       - Kỹ thuật viên C (pos-13, thường)
 */
const mockSnapshot: TenantOrganizationSnapshot = {
  tenantId: 'tenant-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  unitTypes: [],
  units: [
    {
      id: 'root-company',
      code: 'SAVINA',
      name: 'Công ty Cổ phần Năng lượng SAVINA',
      typeId: 'type-corp',
      typeName: 'Công ty',
      typeCategory: 'unit',
      sortOrder: 1,
      memberCount: 15,
      headName: 'Tổng Giám Đốc',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'unit-ketoan',
      code: 'TCKT',
      name: 'Phòng Tài chính - Kế toán',
      parentId: 'root-company',
      typeId: 'type-dept',
      typeName: 'Phòng ban',
      typeCategory: 'unit',
      sortOrder: 1,
      headPositionId: 'pos-3',
      memberCount: 3,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'unit-kythuat',
      code: 'KT',
      name: 'Phòng Kỹ thuật',
      parentId: 'root-company',
      typeId: 'type-dept',
      typeName: 'Phòng ban',
      typeCategory: 'unit',
      sortOrder: 2,
      headPositionId: 'pos-9',
      memberCount: 5,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'unit-thinghiem',
      code: 'TN',
      name: 'Tổ Thí nghiệm',
      parentId: 'unit-kythuat',
      typeId: 'type-team',
      typeName: 'Tổ đội',
      typeCategory: 'unit',
      sortOrder: 1,
      headPositionId: 'pos-11',
      memberCount: 4,
      createdAt: '',
      updatedAt: '',
    },
  ],
  positions: [
    // Phòng Kế toán (L1)
    { id: 'pos-1', key: 'CVTC', name: 'Chuyên viên tài chính', unitId: 'unit-ketoan', sortOrder: 2, createdAt: '' },
    { id: 'pos-2', key: 'NVKT', name: 'Nhân viên kế toán', unitId: 'unit-ketoan', sortOrder: 3, createdAt: '' },
    { id: 'pos-3', key: 'KTT', name: 'Kế toán trưởng', unitId: 'unit-ketoan', sortOrder: 1, createdAt: '' },

    // Phòng Kỹ thuật (L1)
    { id: 'pos-4', key: 'KSD', name: 'Kỹ sư điện', unitId: 'unit-kythuat', sortOrder: 2, createdAt: '' },
    { id: 'pos-5', key: 'KSCK', name: 'Kỹ sư cơ khí', unitId: 'unit-kythuat', sortOrder: 3, createdAt: '' },
    { id: 'pos-9', key: 'TPKT', name: 'Trưởng phòng Kỹ thuật', unitId: 'unit-kythuat', sortOrder: 1, createdAt: '' },

    // Tổ Thí nghiệm (L2)
    { id: 'pos-10', key: 'KTVA', name: 'Kỹ thuật viên A', unitId: 'unit-thinghiem', sortOrder: 2, createdAt: '' },
    { id: 'pos-11', key: 'TT', name: 'Tổ trưởng', unitId: 'unit-thinghiem', sortOrder: 1, createdAt: '' },
    { id: 'pos-12', key: 'KTVB', name: 'Kỹ thuật viên B', unitId: 'unit-thinghiem', sortOrder: 3, createdAt: '' },
    { id: 'pos-13', key: 'KTVC', name: 'Kỹ thuật viên C', unitId: 'unit-thinghiem', sortOrder: 4, createdAt: '' },
  ],
  members: [
    { membershipId: 'm1', userId: 'u1', displayName: 'Nguyễn Văn A', email: 'a@savina.vn', unitId: 'unit-ketoan', positionId: 'pos-3', isHead: true },
    { membershipId: 'm2', userId: 'u2', displayName: 'Trần Thị B', email: 'b@savina.vn', unitId: 'unit-ketoan', positionId: 'pos-1', isHead: false },
    { membershipId: 'm3', userId: 'u3', displayName: 'Lê Văn C', email: 'c@savina.vn', unitId: 'unit-ketoan', positionId: 'pos-1', isHead: false },
    // pos-2 chưa có nhân sự nào
    { membershipId: 'm4', userId: 'u4', displayName: 'Phạm Văn D', email: 'd@savina.vn', unitId: 'unit-kythuat', positionId: 'pos-9', isHead: true },
    { membershipId: 'm5', userId: 'u5', displayName: 'Hoàng Văn E', email: 'e@savina.vn', unitId: 'unit-thinghiem', positionId: 'pos-11', isHead: true },
    { membershipId: 'm6', userId: 'u6', displayName: 'Đặng Văn F', email: 'f@savina.vn', unitId: 'unit-thinghiem', positionId: 'pos-10', isHead: false },
  ],
  membershipSubjects: {},
};

describe('Trải phẳng sơ đồ tổ chức trên Ma trận RCSI', () => {
  it('node gốc root unit ở hàng 1 làm nhóm cha, các node chức danh ở hàng 2', () => {
    const tree = buildHeaderTree(mockSnapshot);

    // Hàng 1 chỉ có 1 node gốc (Root Unit)
    expect(tree.length).toBe(1);
    expect(tree[0].key).toBe('root:root-company');
    expect(tree[0].label).toBe('Công ty Cổ phần Năng lượng SAVINA');
    expect(tree[0].caption).toBe('→ Tổng Giám Đốc');

    // Hàng 2 là toàn bộ các node chức danh (children của root)
    expect(tree[0].children.length).toBe(mockSnapshot.positions.length);
    for (const child of tree[0].children) {
      expect(child.column?.subjectType).toBe('position');
    }

    // Độ sâu header đúng bằng 2 tầng
    expect(treeDepth(tree)).toBe(2);

    // Không tồn tại bất kỳ cột nào có subjectType === 'user'
    const columns = flattenColumns(tree);
    expect(columns.some((c) => (c.subjectType as string) === 'user')).toBe(false);
  });

  it('sắp xếp thứ tự các cột chức danh ở hàng 2 theo Level Order Traversal (BFS) chuẩn xác', () => {
    const tree = buildHeaderTree(mockSnapshot);
    const columns = flattenColumns(tree);
    const columnIds = columns.map((c) => c.subjectId);

    // Thứ tự mong đợi ở hàng 2:
    // 1. Quản lý L1: pos-3 (Kế toán trưởng), pos-9 (Trưởng phòng Kỹ thuật)
    // 2. Quản lý L2: pos-11 (Tổ trưởng)
    // 3. Thường L1: pos-1, pos-2 (Kế toán), pos-4, pos-5 (Kỹ thuật)
    // 4. Thường L2: pos-10, pos-12, pos-13 (Thí nghiệm)
    const expectedOrder = [
      'pos-3',
      'pos-9',
      'pos-11',
      'pos-1',
      'pos-2',
      'pos-4',
      'pos-5',
      'pos-10',
      'pos-12',
      'pos-13',
    ];

    expect(columnIds).toEqual(expectedOrder);
  });

  it('gán cờ isHead = true và highlight cho chức danh Quản lý', () => {
    const tree = buildHeaderTree(mockSnapshot);
    const columns = flattenColumns(tree);

    const managerIds = new Set(['pos-3', 'pos-9', 'pos-11']);
    for (const col of columns) {
      if (managerIds.has(col.subjectId)) {
        expect(col.isHead).toBe(true);
      } else {
        expect(col.isHead).toBe(false);
      }
    }

    // Node header tương ứng ở hàng 2 có highlight === 'head'
    const positionNodes = tree[0].children;
    const headerMap = new Map(positionNodes.map((node) => [node.column?.subjectId, node]));
    expect(headerMap.get('pos-3')?.highlight).toBe('head');
    expect(headerMap.get('pos-9')?.highlight).toBe('head');
    expect(headerMap.get('pos-11')?.highlight).toBe('head');
    expect(headerMap.get('pos-1')?.highlight).toBeUndefined();
    expect(headerMap.get('pos-4')?.highlight).toBeUndefined();
  });

  it('nhân sự có isHead: true nhưng node position không phải là headPositionId của unit thì KHÔNG hiện Quản lý', () => {
    // Giả sử có nhân sự thuộc pos-10 được đặt làm 'vị trí chính' (isHead: true)
    // Nhưng unit-thinghiem có headPositionId là pos-11 (Tổ trưởng), không phải pos-10 (Kỹ thuật viên A)
    const customSnapshot: typeof mockSnapshot = {
      ...mockSnapshot,
      members: [
        ...mockSnapshot.members.map((m) =>
          m.positionId === 'pos-10' ? { ...m, isHead: true } : m,
        ),
      ],
    };

    const tree = buildHeaderTree(customSnapshot);
    const columns = flattenColumns(tree);
    const colPos10 = columns.find((c) => c.subjectId === 'pos-10');
    expect(colPos10).toBeDefined();
    // pos-10 tuyệt đối không được gán isHead = true
    expect(colPos10?.isHead).toBe(false);

    const positionNodes = tree[0].children;
    const headerPos10 = positionNodes.find((n) => n.column?.subjectId === 'pos-10');
    expect(headerPos10?.highlight).toBeUndefined();
  });

  it('hiển thị caption là số lượng nhân sự ({count} nhân sự)', () => {
    const tree = buildHeaderTree(mockSnapshot);
    const columns = flattenColumns(tree);
    const colMap = new Map(columns.map((c) => [c.subjectId, c]));

    // pos-3 có 1 nhân sự (u1)
    expect(colMap.get('pos-3')?.caption).toBe('1 nhân sự');

    // pos-1 có 2 nhân sự (u2, u3)
    expect(colMap.get('pos-1')?.caption).toBe('2 nhân sự');

    // pos-2 có 0 nhân sự
    expect(colMap.get('pos-2')?.caption).toBe('0 nhân sự');

    // pos-10 có 1 nhân sự (u6)
    expect(colMap.get('pos-10')?.caption).toBe('1 nhân sự');
  });

  it('chế độ thu gọn (pruneEmpty) lọc đúng các cột có tham gia và giữ root ở hàng 1', () => {
    const tree = buildHeaderTree(mockSnapshot);

    // Chỉ có pos-3 và pos-10 tham gia
    const pruned = pruneEmpty(tree, new Set(['pos-3', 'pos-10']));
    expect(pruned.length).toBe(1); // rootNode vẫn ở hàng 1
    expect(pruned[0].children.length).toBe(2); // 2 chức danh ở hàng 2

    const prunedIds = flattenColumns(pruned).map((c) => c.subjectId);
    expect(prunedIds).toContain('pos-3');
    expect(prunedIds).toContain('pos-10');
    expect(prunedIds).not.toContain('pos-2');
    expect(prunedIds).not.toContain('pos-4');
  });

  it('chế độ thu gọn (pruneEmpty) với legacy unit ID chỉ giữ lại chức danh Quản lý của unit đó', () => {
    const tree = buildHeaderTree(mockSnapshot);

    // Gán ở cấp đơn vị unit-ketoan: chỉ pos-3 (Kế toán trưởng, Quản lý) được giữ, pos-1 và pos-2 bị ẩn
    const pruned = pruneEmpty(tree, new Set(['unit-ketoan']));
    expect(pruned.length).toBe(1);
    expect(pruned[0].children.length).toBe(1);

    const prunedIds = flattenColumns(pruned).map((c) => c.subjectId);
    expect(prunedIds).toEqual(['pos-3']);
  });
});
