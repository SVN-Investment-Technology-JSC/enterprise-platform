import type {
  OrganizationMember,
  OrganizationPosition,
  OrganizationTreeInfo,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import type { ProcedureSubjectType } from '@enterprise-platform/contracts-procedure-engine';

/** Một cột lá trên ma trận RCSI — nơi thực sự gán được vai trò. */
export interface MatrixColumn {
  /**
   * Định danh theo ĐƯỜNG DẪN trong cây, không phải theo subjectId.
   */
  readonly key: string;
  readonly subjectType: ProcedureSubjectType;
  readonly subjectId: string;
  readonly label: string;
  /** Dòng phụ dưới tên cột: số lượng nhân sự hoặc ghi chú đơn vị gốc. */
  readonly caption?: string;
  /** Mọi subjectId nằm dưới cột này (vd: các userId thuộc chức danh). */
  readonly descendantSubjectIds: readonly string[];
  /**
   * Đơn vị chứa chức danh này.
   * Dùng để suy ra vai KẾ THỪA: vai gán ở cấp đơn vị định tuyến xuống chức danh/thành viên.
   */
  readonly unitId?: string;
  /** Cột này là chức danh Quản lý của đơn vị `unitId`. */
  readonly isHead?: boolean;
  /** Đánh dấu cột này là cột cuối cùng của một sơ đồ tổ chức (khi có từ 2 sơ đồ trở lên). */
  readonly isTreeBoundary?: boolean;
}

/**
 * Node header của bảng ma trận RCSI.
 * Sau khi trải phẳng, mỗi node là 1 cột lá với children: [].
 */
export interface HeaderNode {
  readonly key: string;
  readonly label: string;
  readonly caption?: string;
  readonly toggleId?: string;
  readonly expanded: boolean;
  readonly children: readonly HeaderNode[];
  readonly column?: MatrixColumn;
  /** 'head' = cột chức danh Quản lý, tô nền/badge nổi bật. */
  readonly highlight?: 'head';
  /** Đánh dấu ranh giới kết thúc một sơ đồ tổ chức (khi có từ 2 sơ đồ trở lên). */
  readonly isTreeBoundary?: boolean;
}

/**
 * Xây dựng cây header và các cột ma trận trải phẳng:
 * - 1 Node Gốc ở đầu bảng.
 * - Danh sách các node chức danh (position), KHÔNG hiển thị/xổ người dùng.
 * - Caption hiển thị số lượng nhân sự: "{count} nhân sự".
 * - Sắp xếp cột theo Level Order Traversal (BFS) theo thứ tự sơ đồ phân cấp:
 *   [[Quản lý Level 0], [Quản lý Level 1], ..., [Thường Level 0], [Thường Level 1], ...]
 */
export interface AvailableTree {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isPrimary?: boolean;
  readonly rootUnitId: string;
  readonly positionCount: number;
  readonly activePositionCount: number;
}

/**
 * Trích xuất danh sách các sơ đồ tổ chức có trong tenant snapshot.
 * Hỗ trợ tính số lượng chức danh đang tham gia (activePositionCount) dựa trên relevantSubjects.
 */
export function getAvailableTrees(
  snapshot: TenantOrganizationSnapshot | undefined,
  relevantSubjects?: ReadonlySet<string>,
): AvailableTree[] {
  if (!snapshot?.units?.length) return [];

  const unitNodes = snapshot.units.filter((node) => node.typeCategory !== 'position');
  if (unitNodes.length === 0) return [];

  const unitById = new Map(unitNodes.map((u) => [u.id, u]));

  // Lập chỉ mục cây đơn vị cha - con
  const unitChildren = new Map<string | undefined, OrganizationUnit[]>();
  for (const unit of unitNodes) {
    const pid = unit.parentId ?? undefined;
    const list = unitChildren.get(pid) ?? [];
    list.push(unit);
    unitChildren.set(pid, list);
  }

  // Xác định các đơn vị gốc (Level 0)
  const rootUnits = unitChildren.get(undefined) ?? [];
  if (rootUnits.length === 0 && unitNodes.length > 0) {
    const allUnitIds = new Set(unitNodes.map((u) => u.id));
    const orphans = unitNodes.filter((u) => !u.parentId || !allUnitIds.has(u.parentId));
    rootUnits.push(...orphans);
  }

  // Thu thập danh sách vị trí
  const positions: OrganizationPosition[] = [...(snapshot.positions ?? [])];
  const posIds = new Set(positions.map((p) => p.id));
  for (const u of snapshot.units) {
    if (u.typeCategory === 'position' && u.parentId && !posIds.has(u.id)) {
      positions.push({
        id: u.id,
        key: u.code,
        name: u.name,
        unitId: u.parentId,
        treeId: u.treeId,
        sortOrder: u.sortOrder,
        createdAt: u.createdAt,
      });
      posIds.add(u.id);
    }
  }

  // Kiểm tra chức danh có đang tham gia vào các quy trình hay không
  const isPosActive = (pos: OrganizationPosition): boolean => {
    if (!relevantSubjects) return true;
    if (relevantSubjects.has(pos.id)) return true;
    const parentUnit = unitById.get(pos.unitId);
    if (parentUnit?.headPositionId === pos.id && relevantSubjects.has(parentUnit.id)) {
      return true;
    }
    return false;
  };

  // Ưu tiên sử dụng trực tiếp danh sách snapshot.trees từ database (core_schema.organization_trees)
  if (snapshot.trees && snapshot.trees.length > 0) {
    return snapshot.trees.map((treeInfo, index) => {
      const root =
        rootUnits.find((r) => r.treeId === treeInfo.id) ||
        rootUnits.find((r) => r.id === treeInfo.id || r.code === treeInfo.code) ||
        rootUnits[index];

      let treePositions: OrganizationPosition[] = [];
      if (root) {
        const treeUnitIds = new Set<string>();
        let queue = [root.id];
        while (queue.length > 0) {
          const nextQueue: string[] = [];
          for (const uid of queue) {
            treeUnitIds.add(uid);
            const children = unitChildren.get(uid) ?? [];
            for (const c of children) {
              if (!treeUnitIds.has(c.id)) {
                nextQueue.push(c.id);
              }
            }
          }
          queue = nextQueue;
        }
        treePositions = positions.filter((p) => treeUnitIds.has(p.unitId));
      } else {
        treePositions = positions.filter((p) => p.treeId === treeInfo.id);
      }

      const positionCount = treePositions.length;
      const activePositionCount = relevantSubjects
        ? treePositions.filter(isPosActive).length
        : positionCount;

      return {
        id: treeInfo.id,
        code: treeInfo.code,
        name: treeInfo.name,
        isPrimary: Boolean(treeInfo.isPrimary),
        rootUnitId: root?.id || treeInfo.id,
        positionCount,
        activePositionCount,
      };
    });
  }

  // Fallback: Duyệt theo rootUnits khi snapshot.trees không có sẵn (dữ liệu cũ hoặc mock)
  return rootUnits.map((root, index) => {
    const treeId = root.treeId || root.id;
    const treeInfo = snapshot.trees?.find(
      (t) => t.id === root.treeId || t.id === root.id || t.code === root.code,
    );
    const treeName = treeInfo?.name || root.name;

    // Đếm số chức danh thuộc cây này
    const treeUnitIds = new Set<string>();
    let queue = [root.id];
    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const uid of queue) {
        treeUnitIds.add(uid);
        const children = unitChildren.get(uid) ?? [];
        for (const c of children) {
          if (!treeUnitIds.has(c.id)) {
            nextQueue.push(c.id);
          }
        }
      }
      queue = nextQueue;
    }

    const treePositions = positions.filter((p) => treeUnitIds.has(p.unitId));
    const positionCount = treePositions.length;
    const activePositionCount = relevantSubjects
      ? treePositions.filter(isPosActive).length
      : positionCount;

    return {
      id: treeId,
      code: treeInfo?.code || root.code,
      name: treeName,
      isPrimary: treeInfo?.isPrimary ?? (index === 0),
      rootUnitId: root.id,
      positionCount,
      activePositionCount,
    };
  });
}

/**
 * Xây dựng cây header và các cột ma trận trải phẳng:
 * - Hàng 1: Mỗi sơ đồ tổ chức là 1 Node Gốc riêng biệt (Multi-Tree Header).
 * - Hàng 2: Danh sách các node chức danh (position) thuộc sơ đồ đó.
 * - Sắp xếp cột theo Level Order Traversal (BFS) độc lập trong phạm vi từng sơ đồ:
 *   [[Quản lý Level 0], [Quản lý Level 1], ..., [Thường Level 0], [Thường Level 1], ...]
 */
export function buildHeaderTree(
  snapshot: TenantOrganizationSnapshot | undefined,
  _expanded?: ReadonlySet<string>,
  selectedTreeIds?: ReadonlySet<string>,
): HeaderNode[] {
  if (!snapshot?.units?.length) return [];

  // Lọc lấy các node đơn vị thực tế (loại bỏ node có category là position trong snapshot.units)
  const unitNodes = snapshot.units.filter((node) => node.typeCategory !== 'position');
  if (unitNodes.length === 0) return [];

  // Thu thập danh sách positions từ snapshot.positions và cả các node position trong snapshot.units (nếu có)
  const positions: OrganizationPosition[] = [...(snapshot.positions ?? [])];
  const posIds = new Set(positions.map((p) => p.id));
  for (const u of snapshot.units) {
    if (u.typeCategory === 'position' && u.parentId && !posIds.has(u.id)) {
      positions.push({
        id: u.id,
        key: u.code,
        name: u.name,
        unitId: u.parentId,
        treeId: u.treeId,
        sortOrder: u.sortOrder,
        createdAt: u.createdAt,
      });
      posIds.add(u.id);
    }
  }

  // Lập chỉ mục nhân sự theo từng chức danh
  const membersOfPosition = new Map<string, OrganizationMember[]>();
  for (const member of snapshot.members ?? []) {
    if (!member.positionId) continue;
    const list = membersOfPosition.get(member.positionId) ?? [];
    list.push(member);
    membersOfPosition.set(member.positionId, list);
  }

  // Lập chỉ mục cây đơn vị cha - con
  const unitChildren = new Map<string | undefined, OrganizationUnit[]>();
  for (const unit of unitNodes) {
    const pid = unit.parentId ?? undefined;
    const list = unitChildren.get(pid) ?? [];
    list.push(unit);
    unitChildren.set(pid, list);
  }

  // Sắp xếp các đơn vị con trong cùng một cấp theo sortOrder rồi đến tên tiếng Việt
  for (const list of unitChildren.values()) {
    list.sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, 'vi');
    });
  }

  // Xác định các đơn vị gốc (Level 0)
  const rootUnits = unitChildren.get(undefined) ?? [];
  if (rootUnits.length === 0 && unitNodes.length > 0) {
    const allUnitIds = new Set(unitNodes.map((u) => u.id));
    const orphans = unitNodes.filter((u) => !u.parentId || !allUnitIds.has(u.parentId));
    rootUnits.push(...orphans);
  }

  // Gom các chức danh theo từng đơn vị và sắp xếp theo sortOrder/name
  const positionsOfUnit = new Map<string, OrganizationPosition[]>();
  for (const pos of positions) {
    const list = positionsOfUnit.get(pos.unitId) ?? [];
    list.push(pos);
    positionsOfUnit.set(pos.unitId, list);
  }
  for (const list of positionsOfUnit.values()) {
    list.sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, 'vi');
    });
  }

  const isPositionHead = (pos: OrganizationPosition, unit: OrganizationUnit | undefined): boolean => {
    return Boolean(unit?.headPositionId && unit.headPositionId === pos.id);
  };

  // Lọc các sơ đồ theo selectedTreeIds nếu có
  const activeRoots = rootUnits.filter((root) => {
    if (!selectedTreeIds || selectedTreeIds.size === 0) return true;
    const treeId = root.treeId || root.id;
    return selectedTreeIds.has(treeId) || selectedTreeIds.has(root.id);
  });

  // Nếu bộ lọc làm rỗng thì hiển thị toàn bộ
  const rootsToRender = activeRoots.length > 0 ? activeRoots : rootUnits;

  // Nếu có snapshot.trees, sắp xếp rootsToRender theo thứ tự sơ đồ (sơ đồ chính đứng đầu)
  if (snapshot.trees && snapshot.trees.length > 0) {
    const treeOrder = new Map(snapshot.trees.map((t, idx) => [t.id, idx]));
    rootsToRender.sort((a, b) => {
      const orderA = treeOrder.get(a.treeId || a.id) ?? 999;
      const orderB = treeOrder.get(b.treeId || b.id) ?? 999;
      return orderA - orderB;
    });
  }

  // DUYỆT TỪNG SƠ ĐỒ ĐỘC LẬP:
  // 1. Mỗi sơ đồ tổ chức có 1 Node Gốc ở Hàng 1
  // 2. Các chức danh của sơ đồ nào nằm trọn vẹn dưới sơ đồ đó, sắp xếp BFS nội bộ
  const resultRootNodes: HeaderNode[] = [];

  for (const rootUnit of rootsToRender) {
    const treeInfo = snapshot.trees?.find(
      (t) => t.id === rootUnit.treeId || t.id === rootUnit.id || t.code === rootUnit.code,
    );
    const treeTitle = treeInfo?.name || rootUnit.name;

    // Duyệt BFS đơn vị con của RIÊNG sơ đồ này
    const treeUnitsByLevel: OrganizationUnit[][] = [];
    let currentLevelUnits: OrganizationUnit[] = [rootUnit];
    const visitedUnits = new Set<string>();

    while (currentLevelUnits.length > 0) {
      treeUnitsByLevel.push(currentLevelUnits);
      const nextLevelUnits: OrganizationUnit[] = [];
      for (const parent of currentLevelUnits) {
        visitedUnits.add(parent.id);
        const kids = unitChildren.get(parent.id) ?? [];
        for (const kid of kids) {
          if (!visitedUnits.has(kid.id)) {
            visitedUnits.add(kid.id);
            nextLevelUnits.push(kid);
          }
        }
      }
      currentLevelUnits = nextLevelUnits;
    }

    // Tách chức danh theo từng level thành 2 nhóm: Quản lý và Thành viên thường
    const managersByLevel: OrganizationPosition[][] = [];
    const membersByLevel: OrganizationPosition[][] = [];

    for (let lvl = 0; lvl < treeUnitsByLevel.length; lvl++) {
      const unitsAtLvl = treeUnitsByLevel[lvl];
      const managers: OrganizationPosition[] = [];
      const regulars: OrganizationPosition[] = [];

      for (const unit of unitsAtLvl) {
        const unitPositions = positionsOfUnit.get(unit.id) ?? [];
        for (const pos of unitPositions) {
          if (isPositionHead(pos, unit)) {
            managers.push(pos);
          } else {
            regulars.push(pos);
          }
        }
      }

      managersByLevel.push(managers);
      membersByLevel.push(regulars);
    }

    // Thứ tự trải phẳng các chức danh trong nội bộ sơ đồ này:
    // [[Quản lý L0], [Quản lý L1], ..., [Thường L0], [Thường L1], ...]
    const orderedPositions: { position: OrganizationPosition; isHead: boolean }[] = [];
    for (let lvl = 0; lvl < managersByLevel.length; lvl++) {
      for (const pos of managersByLevel[lvl]) {
        orderedPositions.push({ position: pos, isHead: true });
      }
    }
    for (let lvl = 0; lvl < membersByLevel.length; lvl++) {
      for (const pos of membersByLevel[lvl]) {
        orderedPositions.push({ position: pos, isHead: false });
      }
    }

    // Các cột chức danh của sơ đồ này
    const positionNodes: HeaderNode[] = orderedPositions.map(({ position, isHead }) => {
      const holders = membersOfPosition.get(position.id) ?? [];
      const col: MatrixColumn = {
        key: `position:${position.id}`,
        subjectType: 'position',
        subjectId: position.id,
        label: position.name,
        caption: `${holders.length} nhân sự`,
        descendantSubjectIds: holders.map((h) => h.userId),
        unitId: position.unitId,
        isHead,
      };
      return {
        key: col.key,
        label: col.label,
        caption: col.caption,
        expanded: false,
        children: [],
        column: col,
        highlight: isHead ? 'head' : undefined,
      };
    });

    const rootNode: HeaderNode = {
      key: `root:${rootUnit.id}`,
      label: treeTitle,
      caption: rootUnit.headName ? `→ ${rootUnit.headName}` : 'Đơn vị gốc',
      expanded: true,
      children: positionNodes,
      highlight: 'head',
    };

    resultRootNodes.push(rootNode);
  }

  return resultRootNodes;
}

/** Các cột lá theo đúng thứ tự trái–phải của header. */
export function flattenColumns(nodes: readonly HeaderNode[]): MatrixColumn[] {
  const columns: MatrixColumn[] = [];
  const walk = (node: HeaderNode) => {
    if (node.column) columns.push(node.column);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return columns;
}

/** Số cột lá một node chiếm — chính là colSpan của nó. */
export function leafCount(node: HeaderNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

/** Độ sâu của cây header: 2 tầng (Hàng 1: Node gốc, Hàng 2: Chức danh). */
export function treeDepth(nodes: readonly HeaderNode[]): number {
  return nodes.reduce(
    (deepest, node) =>
      Math.max(deepest, node.children.length === 0 ? 1 : 1 + treeDepth(node.children)),
    1,
  );
}

/**
 * Chế độ thu gọn: chỉ giữ các cột có tham gia ít nhất một vai trò trong quy trình đang mở.
 */
export function pruneEmpty(
  nodes: readonly HeaderNode[],
  used: ReadonlySet<string>,
): HeaderNode[] {
  if (used.size === 0) return [...nodes];

  const keep = (node: HeaderNode): HeaderNode | undefined => {
    const children = node.children
      .map(keep)
      .filter((child): child is HeaderNode => Boolean(child));

    const selfUsed =
      node.column !== undefined &&
      (used.has(node.column.subjectId) ||
        node.column.descendantSubjectIds.some((id) => used.has(id)) ||
        (Boolean(node.column.isHead) &&
          node.column.unitId !== undefined &&
          used.has(node.column.unitId)));

    // Nếu là nhóm cha (Node Gốc ở hàng 1): giữ nếu có ít nhất 1 node con chức danh được giữ
    if (children.length > 0) {
      return { ...node, children };
    }

    // Nếu là cột lá chức danh ở hàng 2:
    if (selfUsed) {
      return { ...node, children: [] };
    }

    return undefined;
  };

  return nodes.map(keep).filter((node): node is HeaderNode => Boolean(node));
}

/**
 * Đánh dấu ranh giới kết thúc của từng sơ đồ tổ chức (khi có từ 2 sơ đồ trở lên hiển thị).
 * - Gán `isTreeBoundary = true` cho Node Gốc của sơ đồ ở Hàng 1 (trừ sơ đồ cuối cùng).
 * - Gán `isTreeBoundary = true` cho cột lá cuối cùng thuộc sơ đồ đó ở Hàng 2 và trên MatrixColumn.
 */
export function markTreeBoundaries(nodes: readonly HeaderNode[]): HeaderNode[] {
  if (nodes.length <= 1) return [...nodes];

  return nodes.map((rootNode, index) => {
    const isBoundary = index < nodes.length - 1;
    if (!isBoundary) return rootNode;

    const markLastLeaf = (node: HeaderNode): HeaderNode => {
      if (node.children.length === 0) {
        return {
          ...node,
          isTreeBoundary: true,
          column: node.column ? { ...node.column, isTreeBoundary: true } : undefined,
        };
      }
      const newChildren = [...node.children];
      const lastIdx = newChildren.length - 1;
      newChildren[lastIdx] = markLastLeaf(newChildren[lastIdx]);
      return {
        ...node,
        children: newChildren,
      };
    };

    const updated = markLastLeaf(rootNode);
    return {
      ...updated,
      isTreeBoundary: true,
    };
  });
}

/**
 * Dữ liệu phục vụ tính năng preview nhanh một chức danh:
 * - Thông tin chức danh và cờ Quản lý (isHead)
 * - Sơ đồ tổ chức chứa chức danh
 * - Cây phân cấp trực thuộc từ Gốc -> Cha -> Đơn vị trực tiếp (duy nhất nhánh này)
 * - Danh sách nhân sự được bổ nhiệm vào chức danh này
 */
export interface PositionPreviewData {
  readonly position: OrganizationPosition;
  readonly isHead: boolean;
  readonly treeInfo?: OrganizationTreeInfo;
  readonly lineage: readonly OrganizationUnit[];
  readonly members: readonly OrganizationMember[];
}

/**
 * Trích xuất đường dẫn phân cấp độc quyền và danh sách nhân sự cho một node chức danh.
 * Đảm bảo chỉ trả về chuỗi các đơn vị cha trực thuộc nối tới chức danh này (không bao gồm
 * các đơn vị anh em hoặc chức danh khác ngoài lề).
 */
export function getPositionPreviewData(
  snapshot: TenantOrganizationSnapshot | undefined,
  positionId: string,
): PositionPreviewData | undefined {
  if (!snapshot || !positionId) return undefined;

  // 1. Tìm thông tin chức danh (ưu tiên snapshot.positions, fallback sang units có typeCategory === 'position')
  let pos = snapshot.positions?.find((p) => p.id === positionId);
  if (!pos) {
    const unitAsPos = snapshot.units?.find(
      (u) => u.id === positionId && u.typeCategory === 'position',
    );
    if (unitAsPos) {
      pos = {
        id: unitAsPos.id,
        key: unitAsPos.code,
        name: unitAsPos.name,
        unitId: unitAsPos.parentId ?? '',
        treeId: unitAsPos.treeId,
        sortOrder: unitAsPos.sortOrder,
        createdAt: unitAsPos.createdAt,
      };
    }
  }

  if (!pos) return undefined;

  // 2. Tìm đơn vị trực tiếp và lần ngược lên gốc để xây dựng lineage duy nhất
  const unitNodes = (snapshot.units ?? []).filter((u) => u.typeCategory !== 'position');
  const unitById = new Map(unitNodes.map((u) => [u.id, u]));

  const parentUnit = unitById.get(pos.unitId);
  const lineage: OrganizationUnit[] = [];
  let curr = parentUnit;
  const visited = new Set<string>();
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    lineage.unshift(curr);
    curr = curr.parentId ? unitById.get(curr.parentId) : undefined;
  }

  // 3. Xác định sơ đồ tổ chức (treeInfo)
  const rootUnit = lineage[0];
  const treeId = pos.treeId || rootUnit?.treeId;
  let treeInfo: OrganizationTreeInfo | undefined;
  if (snapshot.trees && snapshot.trees.length > 0) {
    treeInfo = snapshot.trees.find(
      (t) =>
        (treeId && t.id === treeId) ||
        (rootUnit && (t.id === rootUnit.id || t.code === rootUnit.code || t.id === rootUnit.treeId)),
    );
    if (!treeInfo && rootUnit) {
      treeInfo = snapshot.trees[0];
    }
  }
  if (!treeInfo && rootUnit) {
    treeInfo = {
      id: rootUnit.treeId || rootUnit.id,
      code: rootUnit.code,
      name: rootUnit.name,
      isPrimary: true,
    };
  }

  // 4. Xác định vai trò Quản lý (headPositionId)
  const isHead = Boolean(parentUnit?.headPositionId && parentUnit.headPositionId === pos.id);

  // 5. Danh sách nhân sự được bổ nhiệm
  const members = (snapshot.members ?? []).filter((m) => m.positionId === pos.id);

  return {
    position: pos,
    isHead,
    treeInfo,
    lineage,
    members,
  };
}

/**
 * Các nhánh cần mở sẵn (để tương thích ngược với các caller cũ).
 */
export function ancestorsOfUsed(
  snapshot: TenantOrganizationSnapshot | undefined,
  used: ReadonlySet<string>,
): Set<string> {
  const open = new Set<string>();
  if (!snapshot?.units?.length) return open;

  const members = snapshot.members ?? [];
  const unitById = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  const positionById = new Map((snapshot.positions ?? []).map((p) => [p.id, p]));
  const unitOfUser = new Map(
    members.filter((member) => member.unitId).map((m) => [m.userId, m.unitId as string]),
  );
  const positionOfUser = new Map(
    members.filter((member) => member.positionId).map((m) => [m.userId, m.positionId as string]),
  );

  const openUpFrom = (unitId: string | undefined) => {
    let current = unitId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const unit = unitById.get(current);
      current = unit?.parentId ?? undefined;
      if (current) open.add(current);
    }
  };

  for (const subjectId of used) {
    if (positionById.has(subjectId)) {
      const unitId = positionById.get(subjectId)?.unitId;
      open.add(unitId ?? '');
      openUpFrom(unitId);
    } else if (unitById.has(subjectId)) openUpFrom(subjectId);
    else if (unitOfUser.has(subjectId)) {
      const unitId = unitOfUser.get(subjectId);
      open.add(unitId ?? '');
      open.add(positionOfUser.get(subjectId) ?? '');
      openUpFrom(unitId);
    }
  }
  open.delete('');
  return open;
}

export function allExpandableIds(snapshot: TenantOrganizationSnapshot | undefined): string[] {
  if (!snapshot) return [];
  return [
    ...(snapshot.units ?? []).map((unit) => unit.id),
    ...(snapshot.positions ?? []).map((position) => position.id),
  ];
}

/**
 * Chỉ các đơn vị gốc.
 */
export function rootUnitIds(snapshot: TenantOrganizationSnapshot | undefined): string[] {
  return (snapshot?.units ?? []).filter((unit) => !unit.parentId).map((unit) => unit.id);
}
