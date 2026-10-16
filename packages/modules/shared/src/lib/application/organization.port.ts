/**
 * Sơ đồ tổ chức của tenant, đọc từ organization context của Tenant Core.
 *
 * Hệ dùng chung chỉ cần hai thứ: các node (phòng ban, chức danh) để chia sẻ
 * thư mục theo tổ chức, và ai được bổ nhiệm vào node nào để biết một người
 * thuộc phòng ban, chức danh nào.
 */
export const ORGANIZATION_READER = Symbol('SHARED_ORGANIZATION_READER');

export interface OrganizationNode {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  /** `unit`: phòng, khối, ban, công ty. `position`: chức danh. */
  readonly kind: 'unit' | 'position';
}

/** Một người được bổ nhiệm vào một node — thường là node chức danh. */
export interface OrganizationAssignment {
  readonly userId: string;
  readonly nodeId: string;
}

export interface OrganizationSnapshot {
  readonly nodes: readonly OrganizationNode[];
  readonly assignments: readonly OrganizationAssignment[];
  /** Không đọc được Tenant Core: dữ liệu rỗng hoặc là bản cũ. */
  readonly degraded: boolean;
}

export interface OrganizationReader {
  snapshot(tenantId: string): Promise<OrganizationSnapshot>;
}

/**
 * Mọi node `userId` thuộc về: node được bổ nhiệm và mọi node cha của nó. Chia
 * sẻ cho "Khối thí nghiệm" vì vậy tới được người giữ chức danh ở một phòng
 * nằm dưới khối đó.
 */
export function membershipNodes(snapshot: OrganizationSnapshot, userId: string): Set<string> {
  const parentOf = new Map(snapshot.nodes.map((node) => [node.id, node.parentId]));
  const nodeIds = new Set<string>();
  for (const assignment of snapshot.assignments) {
    if (assignment.userId !== userId) continue;
    let current: string | undefined = assignment.nodeId;
    while (current && !nodeIds.has(current)) {
      nodeIds.add(current);
      current = parentOf.get(current);
    }
  }
  return nodeIds;
}

/** "Công ty › Khối thí nghiệm": tên các node cha của `nodeId`, từ gốc xuống, không gồm chính nó. */
export function nodePath(nodes: ReadonlyMap<string, OrganizationNode>, nodeId: string): string {
  const names: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = nodes.get(nodeId)?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node) break;
    names.unshift(node.name);
    current = node.parentId;
  }
  return names.join(' › ');
}
