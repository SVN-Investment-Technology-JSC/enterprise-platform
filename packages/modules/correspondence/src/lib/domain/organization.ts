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

/** Node và mọi node cha của nó. */
function ancestry(parentOf: ReadonlyMap<string, string | undefined>, nodeId: string): Set<string> {
  const seen = new Set<string>();
  let current: string | undefined = nodeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    current = parentOf.get(current);
  }
  return seen;
}

/** Mọi node người dùng thuộc về: node được bổ nhiệm và mọi node cha. */
export function membershipNodes(snapshot: OrganizationSnapshot, userId: string): Set<string> {
  const parentOf = parents(snapshot);
  const nodes = new Set<string>();
  for (const member of snapshot.members) {
    if (member.userId === userId) for (const id of ancestry(parentOf, member.nodeId)) nodes.add(id);
  }
  return nodes;
}

/** Người thuộc đơn vị, kể cả các đơn vị con; mỗi người một dòng, trưởng đơn vị trước. */
export function unitMembers(snapshot: OrganizationSnapshot, unitId: string): OrganizationMember[] {
  const parentOf = parents(snapshot);
  const heads = new Set(unitHeads(snapshot, unitId, { escalate: false }));
  const byUser = new Map<string, OrganizationMember>();
  for (const member of snapshot.members) {
    if (!ancestry(parentOf, member.nodeId).has(unitId)) continue;
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
