import type {
  OrganizationMember,
  OrganizationPosition,
  OrganizationUnit,
  TenantOrganizationSnapshot,
} from '@enterprise-platform/contracts-organization';
import type { ProcedureSubjectType } from '@enterprise-platform/contracts-procedure-engine';

/** Một cột lá — nơi thực sự gán được vai trò. */
export interface MatrixColumn {
  /**
   * Định danh theo ĐƯỜNG DẪN trong cây, không phải theo subjectId. Người kiêm
   * nhiệm xuất hiện ở nhiều đơn vị nên cùng một subjectId có thể có nhiều cột;
   * nếu lấy subjectId làm key thì React gặp key trùng trong cùng một hàng và gán
   * sai ô khi cây đổi hình.
   */
  readonly key: string;
  readonly subjectType: ProcedureSubjectType;
  readonly subjectId: string;
  readonly label: string;
  /** Dòng phụ dưới tên cột: tên người phụ trách hoặc loại đơn vị. */
  readonly caption?: string;
  /** Mọi subjectId nằm dưới cột này, để gom chỉ báo khi đang thu gọn. */
  readonly descendantSubjectIds: readonly string[];
}

/**
 * Header nhiều tầng. Một node hoặc là nhóm (có children, dựng bằng colSpan) hoặc
 * là cột lá (rowSpan xuống hết bảng). Cùng một cây dùng cho cả header lẫn thân
 * bảng, nên hai phần không bao giờ lệch nhau.
 */
export interface HeaderNode {
  readonly key: string;
  readonly label: string;
  readonly caption?: string;
  /** id để bật/tắt sổ ngang; vắng nghĩa là không sổ được. */
  readonly toggleId?: string;
  readonly expanded: boolean;
  readonly children: readonly HeaderNode[];
  readonly column?: MatrixColumn;
  /**
   * 'head' = cột của người/chức danh phụ trách đơn vị.
   *
   * Đánh dấu để tô nền khác thành viên thường: vai gán ở cấp đơn vị định tuyến
   * về đúng người này, nên nhìn ra họ ngay là cần thiết khi đọc ma trận.
   */
  readonly highlight?: 'head';
}

function childrenIndex(units: readonly OrganizationUnit[]) {
  const map = new Map<string | undefined, OrganizationUnit[]>();
  for (const unit of units) {
    // API trả parentId = null cho đơn vị gốc; ép về undefined để một khoá duy
    // nhất đại diện cho gốc, nếu không cây sẽ rỗng.
    const parentId = unit.parentId ?? undefined;
    const list = map.get(parentId) ?? [];
    list.push(unit);
    map.set(parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return map;
}

export function buildHeaderTree(
  snapshot: TenantOrganizationSnapshot | undefined,
  expanded: ReadonlySet<string>,
): HeaderNode[] {
  if (!snapshot?.units?.length) return [];

  /**
   * `units` của snapshot chứa MỌI node, kể cả chức danh. Chức danh đã có tầng
   * riêng (`snapshot.positions`), nên phải loại khỏi cây đơn vị — không thì mỗi
   * chức danh hiện hai lần: một lần như đơn vị con, một lần ở tầng chức danh.
   */
  const unitNodes = snapshot.units.filter((node) => node.typeCategory !== 'position');
  const children = childrenIndex(unitNodes);
  const positionsOf = new Map<string, OrganizationPosition[]>();
  for (const position of snapshot.positions ?? []) {
    const list = positionsOf.get(position.unitId) ?? [];
    list.push(position);
    positionsOf.set(position.unitId, list);
  }
  const membersOfPosition = new Map<string, OrganizationMember[]>();
  for (const member of snapshot.members ?? []) {
    if (!member.positionId) continue;
    const list = membersOfPosition.get(member.positionId) ?? [];
    list.push(member);
    membersOfPosition.set(member.positionId, list);
  }

  /** Tập id nằm dưới một đơn vị, kể cả khi đang thu gọn. */
  const below = (unitId: string): string[] => {
    const ids: string[] = [];
    const stack = [unitId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      for (const position of positionsOf.get(current) ?? []) {
        ids.push(position.id, ...(membersOfPosition.get(position.id) ?? []).map((p) => p.userId));
      }
      for (const child of children.get(current) ?? []) {
        ids.push(child.id);
        stack.push(child.id);
      }
    }
    return ids;
  };

  /** Một người thành một cột lá. */
  const personNode = (person: OrganizationMember, path: string, isHead: boolean): HeaderNode => {
    const key = `${path}/user:${person.userId}`;
    return {
      key,
      label: person.displayName,
      caption: isHead ? `Phụ trách · ${person.positionName ?? ''}`.trim() : person.positionName,
      highlight: isHead ? ('head' as const) : undefined,
      expanded: false,
      children: [],
      column: {
        key,
        subjectType: 'user' as const,
        subjectId: person.userId,
        label: person.displayName,
        caption: person.positionName,
        descendantSubjectIds: [],
      },
    };
  };

  const walkPosition = (position: OrganizationPosition, path: string): HeaderNode => {
    const people = membersOfPosition.get(position.id) ?? [];
    const isExpanded = expanded.has(position.id);
    const here = `${path}/position:${position.id}`;
    const selfColumn: MatrixColumn = {
      key: here,
      subjectType: 'position',
      subjectId: position.id,
      label: position.name,
      caption: people.length === 1 ? people[0].displayName : `${people.length} người`,
      descendantSubjectIds: people.map((person) => person.userId),
    };

    if (!isExpanded || people.length === 0) {
      return {
        key: selfColumn.key,
        label: position.name,
        caption: selfColumn.caption,
        toggleId: people.length > 0 ? position.id : undefined,
        expanded: false,
        children: [],
        column: selfColumn,
      };
    }

    return {
      key: `${here}#group`,
      label: position.name,
      toggleId: position.id,
      expanded: true,
      children: [
        {
          key: `${here}#self`,
          label: 'Cả chức danh',
          expanded: false,
          children: [],
          column: {
            ...selfColumn,
            key: `${here}#self`,
            label: `${position.name} (cả chức danh)`,
            caption: undefined,
          },
        },
        ...people.map((person) => personNode(person, here, false)),
      ],
    };
  };

  const walkUnit = (unit: OrganizationUnit, path = ''): HeaderNode => {
    const isExpanded = expanded.has(unit.id);
    /**
     * Snapshot thật dồn cả node chức danh vào `units`, và node chức danh nào có
     * người giữ làm chức danh chính thì mang `headMembershipId`. Đó chính là
     * trưởng đơn vị, nên tô nền khác các chức danh còn lại.
     */
    const isHeadPosition = unit.typeCategory === 'position' && Boolean(unit.headMembershipId);
    const subUnits = children.get(unit.id) ?? [];
    const positions = positionsOf.get(unit.id) ?? [];
    const canExpand = subUnits.length > 0 || positions.length > 0;
    const here = `${path}/unit:${unit.id}`;

    const selfColumn: MatrixColumn = {
      key: here,
      subjectType: 'organization_unit',
      subjectId: unit.id,
      label: unit.name,
      // Gán ở cấp đơn vị định tuyến tới người phụ trách, nên hiện luôn tên họ.
      caption: unit.headName ?? 'Chưa có người phụ trách',
      descendantSubjectIds: below(unit.id),
    };

    if (!isExpanded || !canExpand) {
      return {
        key: selfColumn.key,
        label: unit.name,
        caption: selfColumn.caption,
        highlight: isHeadPosition ? ('head' as const) : undefined,
        toggleId: canExpand ? unit.id : undefined,
        expanded: false,
        children: [],
        column: selfColumn,
      };
    }

    /**
     * Chức danh chỉ có đúng một người thì bỏ hẳn tầng chức danh, đưa người lên
     * thẳng dưới đơn vị.
     *
     * Tầng chức danh chỉ có ý nghĩa khi nhiều người cùng giữ một chức danh —
     * lúc đó gán vai trò cho chức danh nghĩa là gán cho tất cả họ. Khi 1:1 thì
     * nó chỉ nhân đôi con người: sổ “Phòng Thí nghiệm” ra lại thấy một tầng
     * “Trưởng phòng Thí nghiệm” rồi mới tới Thịnh.
     */
    const peopleColumns = positions.flatMap((position) => {
      const holders = membersOfPosition.get(position.id) ?? [];
      if (holders.length > 1) return [walkPosition(position, here)];
      return holders.map((person) =>
        personNode(person, here, person.membershipId === unit.headMembershipId),
      );
    });

    return {
      key: `${here}#group`,
      label: unit.name,
      highlight: isHeadPosition ? ('head' as const) : undefined,
      toggleId: unit.id,
      expanded: true,
      children: [
        {
          key: `${here}#self`,
          label: `${unit.name} · cấp đơn vị`,
          caption: unit.headName ? `→ ${unit.headName}` : 'Chưa có người phụ trách',
          // Ô cấp đơn vị chỉ hiện khi đơn vị THỰC SỰ đang giữ vai (pruneEmpty
          // quyết định). Muốn gán mới ở cấp đơn vị thì thu gọn đơn vị lại —
          // lúc đó chính cột đơn vị là ô để bấm.
          //
          // Vẫn phải dựng node này thay vì bỏ hẳn: một vai đã gán ở cấp đơn vị
          // mà người dùng sổ đơn vị ra thì sẽ không còn ô nào hiển thị nó, và
          // vai đó biến mất khỏi màn hình dù dữ liệu vẫn còn nguyên.
          expanded: false,
          children: [],
          column: { ...selfColumn, key: `${here}#self`, descendantSubjectIds: [] },
        },
        ...peopleColumns,
        ...subUnits.map((child) => walkUnit(child, here)),
      ],
    };
  };

  return (children.get(undefined) ?? []).map((root) => walkUnit(root));
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

export function treeDepth(nodes: readonly HeaderNode[]): number {
  return nodes.reduce(
    (deepest, node) =>
      Math.max(deepest, node.children.length === 0 ? 1 : 1 + treeDepth(node.children)),
    1,
  );
}

/**
 * Chế độ thu gọn: chỉ giữ nhánh có ít nhất một vai trò.
 *
 * Không có ngoại lệ nào — một đơn vị không tham gia quy trình nào đang mở thì
 * không hiện, kể cả khi cấp cha của nó đang được sổ. Chỗ để thấy đơn vị chưa có
 * vai trò là chế độ Mở rộng.
 */
export function pruneEmpty(
  nodes: readonly HeaderNode[],
  used: ReadonlySet<string>,
): HeaderNode[] {
  const keep = (node: HeaderNode): HeaderNode | undefined => {
    const children = node.children
      .map(keep)
      .filter((child): child is HeaderNode => Boolean(child));
    const selfUsed =
      node.column !== undefined &&
      (used.has(node.column.subjectId) ||
        node.column.descendantSubjectIds.some((id) => used.has(id)));
    // Neo của CHỨC DANH luôn được giữ: gán vai cho một chức danh nhiều người
    // giữ nghĩa là gán cho tất cả họ, và đó là thao tác bình thường.
    //
    // Neo của ĐƠN VỊ thì không: ma trận đã bỏ cột "cả đơn vị" cho gọn. Nó chỉ
    // hiện khi đơn vị đang thực sự giữ vai, để vai đó không biến mất khỏi màn
    // hình khi người dùng sổ đơn vị ra.
    // Xét ĐOẠN CUỐI của khoá: đường dẫn của neo chức danh cũng đi qua các đoạn
    // `/unit:`, nên kiểm tra cả chuỗi sẽ nhận nhầm.
    const lastSegment = node.key.split('/').at(-1) ?? '';
    const isAnchor = lastSegment.startsWith('position:') && lastSegment.endsWith('#self');
    if (!selfUsed && !isAnchor && children.length === 0) return undefined;
    return { ...node, children };
  };
  return nodes.map(keep).filter((node): node is HeaderNode => Boolean(node));
}

/**
 * Các nhánh cần sổ sẵn để mọi vai trò đã gán đều nhìn thấy ngay khi mở bảng.
 * Không có nó, bảng mở ra chỉ với cột pháp nhân gốc và người dùng phải tự mò.
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
      // Chỉ cần sổ các cấp CHA; bản thân đơn vị giữ vai trò vẫn hiện ở dạng cột lá.
      if (current) open.add(current);
    }
  };

  for (const subjectId of used) {
    // Xét CHỨC DANH trước: `units` chứa cả node chức danh, nên nếu xét đơn vị
    // trước thì nhánh chức danh không bao giờ chạy và tầng chức danh không được
    // sổ ra — vai gán cho chức danh sẽ hiện thành một chip gộp thay vì đúng cột.
    if (positionById.has(subjectId)) {
      const unitId = positionById.get(subjectId)?.unitId;
      open.add(unitId ?? '');
      openUpFrom(unitId);
    } else if (unitById.has(subjectId)) openUpFrom(subjectId);
    else if (unitOfUser.has(subjectId)) {
      const unitId = unitOfUser.get(subjectId);
      open.add(unitId ?? '');
      // Sổ luôn chức danh của họ, để cột hiện đúng tên người được gán đích danh
      // thay vì một chip gộp ở cấp chức danh.
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
 * Chỉ các đơn vị gốc — dùng cho nút “Mở rộng”: sổ đúng một tầng để thấy các đơn
 * vị con của gốc, rồi người dùng tự bấm [+] đi sâu tiếp. Sổ hết một lần ra 137
 * cột thì không ai dùng được.
 */
export function rootUnitIds(snapshot: TenantOrganizationSnapshot | undefined): string[] {
  return (snapshot?.units ?? []).filter((unit) => !unit.parentId).map((unit) => unit.id);
}
