/**
 * Sơ đồ tổ chức như Văn thư cần: node (đơn vị, chức danh) và ai được bổ nhiệm vào node
 * nào, có phải trưởng đơn vị không. Hàm thuần, không gọi mạng.
 */

export interface OrganizationNode {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  /** `unit`: phòng, khối, công ty. `position`: chức danh. */
  readonly kind: 'unit' | 'position';
}

export interface OrganizationMember {
  readonly userId: string;
  readonly name: string;
  /** Node được bổ nhiệm, thường là một chức danh. */
  readonly nodeId: string;
  readonly positionName?: string;
  readonly isHead: boolean;
}

export interface OrganizationSnapshot {
  readonly nodes: readonly OrganizationNode[];
  readonly members: readonly OrganizationMember[];
  /** Không đọc được Tenant Core: dữ liệu rỗng hoặc là bản cũ. */
  readonly degraded: boolean;
}

function parents(snapshot: OrganizationSnapshot): Map<string, string | undefined> {
  return new Map(snapshot.nodes.map((node) => [node.id, node.parentId]));
}

/**
 * Đơn vị trực tiếp chứa một node: chính nó nếu là đơn vị, không thì đơn vị gần nhất phía trên
 * (chức danh có thể nằm dưới chức danh khác).
 */
function nearestUnit(snapshot: OrganizationSnapshot, nodeId: string): string | undefined {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let current: string | undefined = nodeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) return undefined;
    if (node.kind === 'unit') return node.id;
    current = node.parentId;
  }
  return undefined;
}

/**
 * Đơn vị người dùng trực tiếp thuộc về (đơn vị chứa chức danh được bổ nhiệm). Không tính đơn vị
 * cha: nhân viên Phòng Kinh doanh không phải là nhân sự của Ban Tổng Giám đốc chỉ vì phòng nằm
 * dưới ban trong sơ đồ.
 */
export function memberUnits(snapshot: OrganizationSnapshot, userId: string): Set<string> {
  const units = new Set<string>();
  for (const member of snapshot.members) {
    if (member.userId !== userId) continue;
    const unitId = nearestUnit(snapshot, member.nodeId);
    if (unitId) units.add(unitId);
  }
  return units;
}

/**
 * Nhân sự của đơn vị: người được bổ nhiệm vào đơn vị hay chức danh trực thuộc nó; không gồm
 * người của các đơn vị con (phòng con là phòng ban riêng). Mỗi người một dòng, trưởng đơn vị trước.
 */
export function unitMembers(snapshot: OrganizationSnapshot, unitId: string): OrganizationMember[] {
  const heads = new Set(unitHeads(snapshot, unitId, { escalate: false }));
  const byUser = new Map<string, OrganizationMember>();
  for (const member of snapshot.members) {
    if (nearestUnit(snapshot, member.nodeId) !== unitId) continue;
    const isHead = heads.has(member.userId);
    const known = byUser.get(member.userId);
    if (!known || (isHead && !known.isHead)) byUser.set(member.userId, { ...member, isHead });
  }
  return [...byUser.values()].sort(
    (left, right) => Number(right.isHead) - Number(left.isHead) || left.name.localeCompare(right.name, 'vi'),
  );
}

/**
 * Trưởng đơn vị: người được đánh dấu trưởng ở chính đơn vị hay ở một chức danh trực thuộc
 * nó. Đơn vị chưa có trưởng thì (mặc định) leo lên đơn vị cha gần nhất có trưởng.
 */
export function unitHeads(
  snapshot: OrganizationSnapshot,
  unitId: string,
  options: { readonly escalate?: boolean } = {},
): string[] {
  const parentOf = parents(snapshot);
  const seen = new Set<string>();
  let current: string | undefined = unitId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const target = current;
    const heads = snapshot.members
      .filter((member) => member.isHead && (member.nodeId === target || parentOf.get(member.nodeId) === target))
      .map((member) => member.userId);
    if (heads.length > 0) return [...new Set(heads)];
    if (options.escalate === false) return [];
    current = parentOf.get(current);
  }
  return [];
}

/** Người đang giữ một trong các chức danh. */
export function positionHolders(snapshot: OrganizationSnapshot, positionIds: readonly string[]): string[] {
  const wanted = new Set(positionIds);
  return [...new Set(snapshot.members.filter((member) => wanted.has(member.nodeId)).map((member) => member.userId))];
}

/** "Công ty › Khối kinh doanh": tên các node cha, không gồm chính nó. */
export function nodePath(snapshot: OrganizationSnapshot, nodeId: string): string {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const names: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = byId.get(nodeId)?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    names.unshift(node.name);
    current = node.parentId;
  }
  return names.join(' › ');
}

/** Tên hiển thị của người theo sơ đồ tổ chức (người dùng chưa bổ nhiệm thì không có). */
export function memberName(snapshot: OrganizationSnapshot, userId: string): string | undefined {
  return snapshot.members.find((member) => member.userId === userId)?.name;
}

/** Đơn vị người dùng là trưởng: đơn vị được đánh dấu trực tiếp, hay đơn vị cha của chức danh trưởng. */
export function headedUnits(snapshot: OrganizationSnapshot, userId: string): Set<string> {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const units = new Set<string>();
  for (const member of snapshot.members) {
    if (member.userId !== userId || !member.isHead) continue;
    const node = byId.get(member.nodeId);
    if (node?.kind === 'unit') units.add(node.id);
    else if (node?.parentId) units.add(node.parentId);
  }
  return units;
}
