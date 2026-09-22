import type {
  OrganizationMember,
  OrganizationPosition,
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
}

/**
 * Xây dựng cây header và các cột ma trận trải phẳng:
 * - 1 Node Gốc ở đầu bảng.
 * - Danh sách các node chức danh (position), KHÔNG hiển thị/xổ người dùng.
 * - Caption hiển thị số lượng nhân sự: "{count} nhân sự".
 * - Sắp xếp cột theo Level Order Traversal (BFS) theo thứ tự sơ đồ phân cấp:
 *   [[Quản lý Level 0], [Quản lý Level 1], ..., [Thường Level 0], [Thường Level 1], ...]
 */
export function buildHeaderTree(
  snapshot: TenantOrganizationSnapshot | undefined,
  _expanded?: ReadonlySet<string>,
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

  // Duyệt cây đơn vị theo BFS (Level Order Traversal)
  const unitsByLevel: OrganizationUnit[][] = [];
  let currentLevelUnits: OrganizationUnit[] = [...rootUnits];
  const visitedUnits = new Set<string>();

  while (currentLevelUnits.length > 0) {
    unitsByLevel.push(currentLevelUnits);
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

  // Gom các đơn vị mồ côi (nếu có) vào cấp cuối cùng
  const unreached = unitNodes.filter((u) => !visitedUnits.has(u.id));
  if (unreached.length > 0) {
    unreached.sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, 'vi');
    });
    unitsByLevel.push(unreached);
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

  // Kiểm tra một chức danh có phải là Quản lý của đơn vị hay không:
  // CHỈ căn cứ vào cấu hình chức danh quản lý của đơn vị (unit.headPositionId === pos.id),
  // KHÔNG phụ thuộc vào việc nhân sự bổ nhiệm có được đánh dấu 'vị trí chính' (m.isHead) hay không.
  const isPositionHead = (pos: OrganizationPosition, unit: OrganizationUnit | undefined): boolean => {
    return Boolean(unit?.headPositionId && unit.headPositionId === pos.id);
  };

  // Tách chức danh theo từng level thành 2 nhóm: Quản lý và Thành viên thường
  const managersByLevel: OrganizationPosition[][] = [];
  const membersByLevel: OrganizationPosition[][] = [];

  for (let lvl = 0; lvl < unitsByLevel.length; lvl++) {
    const unitsAtLvl = unitsByLevel[lvl];
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

  // Thứ tự trải phẳng các chức danh:
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

  // 1. Các cột chức danh đã được sắp xếp
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

  // 2. Node Gốc (Root unit) ở Hàng 1 (hàng đầu) làm nhóm cha
  const primaryRoot = rootUnits[0];
  const rootNode: HeaderNode | undefined = primaryRoot
    ? {
        key: `root:${primaryRoot.id}`,
        label: primaryRoot.name,
        caption: primaryRoot.headName ? `→ ${primaryRoot.headName}` : 'Đơn vị gốc',
        expanded: true,
        children: positionNodes,
        highlight: 'head',
      }
    : undefined;

  // 3. Trả về cây 2 tầng: Hàng 1 là Node Gốc, Hàng 2 là các node chức danh
  return rootNode ? [rootNode] : positionNodes;
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
