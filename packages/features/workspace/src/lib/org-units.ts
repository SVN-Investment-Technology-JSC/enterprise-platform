import type { DirectoryOrgNode } from '@enterprise-platform/contracts-workspace';

/** Một đơn vị (phòng ban) để chọn: tên, và đường dẫn các đơn vị cha để phân biệt hai phòng trùng tên. */
export interface OrgUnitOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * Các đơn vị trên cây tổ chức (bỏ chức danh), theo thứ tự duyệt cây: cha trước con, anh em theo tên. Mỗi mục kèm
 * đường dẫn cha "Công ty › Khối kỹ thuật".
 */
export function orgUnitOptions(nodes: readonly DirectoryOrgNode[]): OrgUnitOption[] {
  const units = nodes.filter((node) => node.kind === 'unit');
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const children = new Map<string, DirectoryOrgNode[]>();
  for (const unit of units) {
    const parent = unit.parentId && byId.has(unit.parentId) ? unit.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), unit]);
  }
  const options: OrgUnitOption[] = [];
  const walk = (parentId: string, path: readonly string[]) => {
    const list = [...(children.get(parentId) ?? [])].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    for (const unit of list) {
      options.push({
        value: unit.id,
        label: unit.name,
        ...(path.length > 0 ? { description: path.join(' › ') } : {}),
      });
      walk(unit.id, [...path, unit.name]);
    }
  };
  walk('', []);
  return options;
}

/** Đơn vị `unitIds` và mọi đơn vị con cháu của chúng (để lọc "thuộc phòng ban" tính cả phòng con). */
export function withDescendantUnits(
  nodes: readonly DirectoryOrgNode[],
  unitIds: readonly string[],
): Set<string> {
  const result = new Set(unitIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id) && node.kind === 'unit') {
        result.add(node.id);
        grew = true;
      }
    }
  }
  return result;
}
