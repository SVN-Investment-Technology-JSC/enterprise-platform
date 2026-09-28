import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import {
  buildHeaderTree,
  flattenColumns,
  getAvailableTrees,
  getPositionPreviewData,
  markTreeBoundaries,
  pruneEmpty,
  treeDepth,
} from './columns';

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

describe('Xử lý nhiều sơ đồ tổ chức (Multi-Tree Organization)', () => {
  const mockMultiTreeSnapshot: TenantOrganizationSnapshot = {
    tenantId: 'tenant-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    trees: [
      { id: 'tree-1', code: 'MAIN', name: 'Sơ đồ Tổng công ty', isPrimary: true },
      { id: 'tree-2', code: 'TECH', name: 'Trung tâm Phát triển Phần mềm', isPrimary: false },
    ],
    unitTypes: [],
    units: [
      // Sơ đồ 1
      {
        id: 'root-company',
        treeId: 'tree-1',
        code: 'SAVINA',
        name: 'Công ty Cổ phần Năng lượng SAVINA',
        typeId: 'type-corp',
        typeName: 'Công ty',
        typeCategory: 'unit',
        sortOrder: 1,
        memberCount: 2,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'unit-ketoan',
        treeId: 'tree-1',
        code: 'TCKT',
        name: 'Phòng Tài chính - Kế toán',
        parentId: 'root-company',
        typeId: 'type-dept',
        typeName: 'Phòng ban',
        typeCategory: 'unit',
        sortOrder: 1,
        headPositionId: 'pos-ktt',
        memberCount: 2,
        createdAt: '',
        updatedAt: '',
      },

      // Sơ đồ 2
      {
        id: 'root-tech',
        treeId: 'tree-2',
        code: 'TECH-CENTER',
        name: 'Trung tâm Phát triển Phần mềm',
        typeId: 'type-corp',
        typeName: 'Trung tâm',
        typeCategory: 'unit',
        sortOrder: 2,
        memberCount: 3,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'unit-dev',
        treeId: 'tree-2',
        code: 'DEV-TEAM',
        name: 'Phòng Phát triển',
        parentId: 'root-tech',
        typeId: 'type-dept',
        typeName: 'Phòng ban',
        typeCategory: 'unit',
        sortOrder: 1,
        headPositionId: 'pos-pgd',
        memberCount: 3,
        createdAt: '',
        updatedAt: '',
      },
    ],
    positions: [
      // Chức danh Sơ đồ 1
      { id: 'pos-ktt', key: 'KTT', name: 'Kế toán trưởng', unitId: 'unit-ketoan', treeId: 'tree-1', sortOrder: 1, createdAt: '' },
      { id: 'pos-nvkt', key: 'NVKT', name: 'Nhân viên kế toán', unitId: 'unit-ketoan', treeId: 'tree-1', sortOrder: 2, createdAt: '' },

      // Chức danh Sơ đồ 2
      { id: 'pos-pgd', key: 'PGD', name: 'Phó Giám đốc Trung tâm', unitId: 'unit-dev', treeId: 'tree-2', sortOrder: 1, createdAt: '' },
      { id: 'pos-mobile', key: 'MOB', name: 'Nhân viên mobile', unitId: 'unit-dev', treeId: 'tree-2', sortOrder: 2, createdAt: '' },
      { id: 'pos-web', key: 'WEB', name: 'Nhân viên web', unitId: 'unit-dev', treeId: 'tree-2', sortOrder: 3, createdAt: '' },
    ],
    members: [],
    membershipSubjects: {},
  };

  it('getAvailableTrees trích xuất đầy đủ danh sách sơ đồ kèm số lượng chức danh', () => {
    const trees = getAvailableTrees(mockMultiTreeSnapshot);
    expect(trees.length).toBe(2);

    expect(trees[0]).toEqual({
      id: 'tree-1',
      code: 'MAIN',
      name: 'Sơ đồ Tổng công ty',
      isPrimary: true,
      rootUnitId: 'root-company',
      positionCount: 2,
      activePositionCount: 2,
    });

    expect(trees[1]).toEqual({
      id: 'tree-2',
      code: 'TECH',
      name: 'Trung tâm Phát triển Phần mềm',
      isPrimary: false,
      rootUnitId: 'root-tech',
      positionCount: 3,
      activePositionCount: 3,
    });

    // Khi lọc theo relevantSubjects (chỉ có pos-pgd của Tree 2 tham gia)
    const filteredTrees = getAvailableTrees(mockMultiTreeSnapshot, new Set(['pos-pgd']));
    expect(filteredTrees[0].activePositionCount).toBe(0); // Tree 1 có 0 chức danh tham gia
    expect(filteredTrees[1].activePositionCount).toBe(1); // Tree 2 có 1 chức danh tham gia (pos-pgd)
  });

  it('hiển thị độc lập 2 node gốc ở Hàng 1 và không bị trộn lẫn chức danh giữa các sơ đồ', () => {
    const tree = buildHeaderTree(mockMultiTreeSnapshot);

    // Hàng 1 có 2 node gốc độc lập tương ứng với 2 sơ đồ tổ chức
    expect(tree.length).toBe(2);
    expect(tree[0].key).toBe('root:root-company');
    expect(tree[0].label).toBe('Sơ đồ Tổng công ty');
    expect(tree[0].children.map((c) => c.column?.subjectId)).toEqual(['pos-ktt', 'pos-nvkt']);

    expect(tree[1].key).toBe('root:root-tech');
    expect(tree[1].label).toBe('Trung tâm Phát triển Phần mềm');
    expect(tree[1].children.map((c) => c.column?.subjectId)).toEqual(['pos-pgd', 'pos-mobile', 'pos-web']);

    // Khi flatten, chức danh của Sơ đồ 1 xuất hiện trọn vẹn trước, sau đó mới tới Sơ đồ 2
    const columns = flattenColumns(tree);
    const colIds = columns.map((c) => c.subjectId);
    expect(colIds).toEqual(['pos-ktt', 'pos-nvkt', 'pos-pgd', 'pos-mobile', 'pos-web']);
  });

  it('bộ lọc selectedTreeIds chỉ hiển thị đúng các sơ đồ được chọn', () => {
    // Chỉ chọn Sơ đồ 2
    const treeOnly2 = buildHeaderTree(mockMultiTreeSnapshot, undefined, new Set(['tree-2']));
    expect(treeOnly2.length).toBe(1);
    expect(treeOnly2[0].key).toBe('root:root-tech');
    expect(treeOnly2[0].children.map((c) => c.column?.subjectId)).toEqual([
      'pos-pgd',
      'pos-mobile',
      'pos-web',
    ]);

    // Chỉ chọn Sơ đồ 1
    const treeOnly1 = buildHeaderTree(mockMultiTreeSnapshot, undefined, new Set(['tree-1']));
    expect(treeOnly1.length).toBe(1);
    expect(treeOnly1[0].key).toBe('root:root-company');
    expect(treeOnly1[0].children.map((c) => c.column?.subjectId)).toEqual(['pos-ktt', 'pos-nvkt']);
  });

  it('markTreeBoundaries đánh dấu chính xác ranh giới giữa các sơ đồ', () => {
    const rawTree = buildHeaderTree(mockMultiTreeSnapshot);
    const tree = markTreeBoundaries(rawTree);

    // Tree 1 là cây đứng trước cây cuối cùng -> được đánh dấu isTreeBoundary = true
    expect(tree[0].isTreeBoundary).toBe(true);
    // Cột lá cuối cùng của Tree 1 (pos-nvkt) được đánh dấu isTreeBoundary = true
    expect(tree[0].children[0].isTreeBoundary).toBeFalsy();
    expect(tree[0].children[1].isTreeBoundary).toBe(true);
    expect(tree[0].children[1].column?.isTreeBoundary).toBe(true);

    // Tree 2 là cây cuối cùng -> KHÔNG có isTreeBoundary
    expect(tree[1].isTreeBoundary).toBeFalsy();
    expect(tree[1].children.every((c) => !c.isTreeBoundary)).toBe(true);

    // flattenColumns giữ nguyên isTreeBoundary trên cột
    const columns = flattenColumns(tree);
    expect(columns[1].isTreeBoundary).toBe(true); // pos-nvkt
    expect(columns[0].isTreeBoundary).toBeFalsy();
    expect(columns[2].isTreeBoundary).toBeFalsy();

    // Khi chỉ có 1 sơ đồ, không đánh dấu ranh giới
    const singleTree = markTreeBoundaries([rawTree[0]]);
    expect(singleTree[0].isTreeBoundary).toBeFalsy();
    expect(singleTree[0].children[1].isTreeBoundary).toBeFalsy();
  });

  describe('getPositionPreviewData', () => {
    it('trích xuất chính xác đường dẫn phân cấp độc quyền (lineage) từ node gốc tới chức danh', () => {
      // pos-10 (Kỹ thuật viên A) thuộc Tổ Thí nghiệm -> Phòng Kỹ thuật -> SAVINA
      const preview = getPositionPreviewData(mockSnapshot, 'pos-10');
      expect(preview).toBeDefined();
      expect(preview?.position.id).toBe('pos-10');
      expect(preview?.position.name).toBe('Kỹ thuật viên A');

      // Chuỗi lineage chỉ gồm 3 cấp cha dẫn tới chức danh này (SAVINA -> KT -> TN)
      expect(preview?.lineage.map((u) => u.id)).toEqual([
        'root-company',
        'unit-kythuat',
        'unit-thinghiem',
      ]);
      expect(preview?.lineage.map((u) => u.name)).toEqual([
        'Công ty Cổ phần Năng lượng SAVINA',
        'Phòng Kỹ thuật',
        'Tổ Thí nghiệm',
      ]);

      // Không chứa các đơn vị khác (như Phòng Kế toán)
      expect(preview?.lineage.some((u) => u.id === 'unit-ketoan')).toBe(false);

      // Cờ Quản lý: pos-10 là thường -> false; pos-11 (Tổ trưởng) -> true
      expect(preview?.isHead).toBe(false);

      const previewHead = getPositionPreviewData(mockSnapshot, 'pos-11');
      expect(previewHead?.isHead).toBe(true);

      // Danh sách nhân sự: pos-10 có 1 nhân sự (Đặng Văn F)
      expect(preview?.members.length).toBe(1);
      expect(preview?.members[0].displayName).toBe('Đặng Văn F');

      // pos-2 chưa có nhân sự nào
      const previewEmpty = getPositionPreviewData(mockSnapshot, 'pos-2');
      expect(previewEmpty?.members.length).toBe(0);

      // Thông tin sơ đồ tổ chức
      expect(preview?.treeInfo).toBeDefined();
      expect(preview?.treeInfo?.name).toBe('Công ty Cổ phần Năng lượng SAVINA');
    });

    it('trả về undefined nếu không tìm thấy chức danh hoặc snapshot rỗng', () => {
      expect(getPositionPreviewData(undefined, 'pos-1')).toBeUndefined();
      expect(getPositionPreviewData(mockSnapshot, 'pos-non-existent')).toBeUndefined();
    });
  });
});

