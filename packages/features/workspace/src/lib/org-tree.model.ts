import type { DirectoryOrgNode, DirectoryPerson } from '@enterprise-platform/contracts-workspace';

/** Trạng thái ô tích của một đơn vị: tất cả, một phần ("-"), hoặc chưa ai. */
export type CheckState = 'checked' | 'indeterminate' | 'unchecked';

export interface OrgTreeModel {
  /** Node có người, xếp theo cha: gốc ở `roots`, con ở `children`. */
  readonly roots: readonly DirectoryOrgNode[];
  readonly children: ReadonlyMap<string, readonly DirectoryOrgNode[]>;
  /** Mọi người dưới một node (kể cả node con, chức danh bên dưới). */
  readonly under: ReadonlyMap<string, readonly string[]>;
  /** Người được bổ nhiệm thẳng vào node, không qua node con nào đang hiện. */
  readonly direct: ReadonlyMap<string, readonly DirectoryPerson[]>;
}

/**
 * Dựng cây chỉ gồm node có người. `orgNodeIds` của mỗi người đã gồm cả chuỗi
 * node cha, nên "người dưới node" chỉ là đối chiếu id.
 */
export function buildOrgTree(
  nodes: readonly DirectoryOrgNode[],
  people: readonly DirectoryPerson[],
): OrgTreeModel {
  const under = new Map<string, string[]>();
  for (const person of people) {
    for (const nodeId of new Set(person.orgNodeIds ?? [])) {
      const list = under.get(nodeId) ?? [];
      list.push(person.userId);
      under.set(nodeId, list);
    }
  }

  const present = nodes.filter((node) => under.has(node.id));
  const ids = new Set(present.map((node) => node.id));
  const children = new Map<string, DirectoryOrgNode[]>();
  const roots: DirectoryOrgNode[] = [];
  for (const node of present) {
    if (node.parentId && ids.has(node.parentId)) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    } else {
      roots.push(node);
    }
  }

  const direct = new Map<string, DirectoryPerson[]>();
  for (const person of people) {
    const own = new Set(person.orgNodeIds ?? []);
    for (const nodeId of own) {
      if (!ids.has(nodeId)) continue;
      const hasChildOfPerson = (children.get(nodeId) ?? []).some((child) => own.has(child.id));
      if (hasChildOfPerson) continue;
      const list = direct.get(nodeId) ?? [];
      list.push(person);
      direct.set(nodeId, list);
    }
  }

  return { roots, children, under, direct };
}

/**
 * Trạng thái ô tích của một nhóm người.
 *
 * Chỉ tính người còn chọn được (`locked` là người đã có trong dự án). Nhóm
 * không còn ai chọn được thì coi như đã chọn đủ và khoá.
 */
export function checkStateOf(
  userIds: readonly string[],
  picked: ReadonlySet<string>,
  locked: ReadonlySet<string>,
): CheckState {
  const free = userIds.filter((userId) => !locked.has(userId));
  if (free.length === 0) return 'checked';
  const count = free.filter((userId) => picked.has(userId)).length;
  if (count === 0) return 'unchecked';
  return count === free.length ? 'checked' : 'indeterminate';
}

/** Tích một nhóm: chưa đủ thì chọn hết, đã đủ thì bỏ hết. Người bị khoá giữ nguyên. */
export function toggleGroup(
  userIds: readonly string[],
  picked: ReadonlySet<string>,
  locked: ReadonlySet<string>,
): Set<string> {
  const next = new Set(picked);
  const free = userIds.filter((userId) => !locked.has(userId));
  if (checkStateOf(userIds, picked, locked) === 'checked') {
    for (const userId of free) next.delete(userId);
  } else {
    for (const userId of free) next.add(userId);
  }
  return next;
}
