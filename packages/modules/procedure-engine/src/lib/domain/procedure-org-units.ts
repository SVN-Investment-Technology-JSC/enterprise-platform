/** Phần của snapshot tổ chức (Tenant Core) mà tầng phân quyền cần; khai báo theo cấu trúc để module không phụ thuộc contract tổ chức. */
export interface ProcedureOrganizationSnapshot {
  readonly units: readonly {
    readonly id: string;
    readonly parentId?: string;
    readonly typeCategory?: 'unit' | 'position';
    readonly headMembershipId?: string;
  }[];
  readonly members: readonly { readonly isHead: boolean; readonly unitId?: string }[];
}

/**
 * Dựng bản đồ đơn vị cho tầng phân quyền.
 *
 * `units` trong snapshot chứa MỌI node, cả đơn vị lẫn chức danh; `typeCategory`
 * là thứ phân biệt hai loại. Người chỉ được bổ nhiệm vào node chức danh, nên một
 * vai gán ở cấp đơn vị phải được phân giải xuống chức danh phụ trách nằm ngay
 * dưới đơn vị đó, nếu không sẽ không ai khớp.
 */
export function buildProcedureOrgUnits(
  organization: ProcedureOrganizationSnapshot,
): Map<
  string,
  {
    parentId?: string;
    hasHead: boolean;
    category?: 'unit' | 'position';
    headPositionIds: string[];
    memberPositionIds: string[];
  }
> {
  const headedNodeIds = new Set(
    organization.members.filter((member) => member.isHead && member.unitId).map((member) => member.unitId as string),
  );

  const headPositionsByParent = new Map<string, string[]>();
  for (const node of organization.units) {
    if (node.typeCategory !== 'position' || !node.parentId) continue;
    if (!headedNodeIds.has(node.id)) continue;
    headPositionsByParent.set(node.parentId, [
      ...(headPositionsByParent.get(node.parentId) ?? []),
      node.id,
    ]);
  }

  // Chức danh nằm dưới một đơn vị, kể cả qua nhiều cấp. Vai S gán ở cấp đơn vị
  // trải xuống toàn bộ danh sách này.
  const childrenByParent = new Map<string, string[]>();
  for (const node of organization.units) {
    if (!node.parentId) continue;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node.id]);
  }
  const categoryById = new Map(organization.units.map((node) => [node.id, node.typeCategory]));

  const descendantPositions = (rootId: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      // Cây tổ chức về lý thuyết không có vòng lặp, nhưng một bản ghi hỏng
      // không được phép làm treo request xác thực quyền.
      if (seen.has(id)) continue;
      seen.add(id);
      if (categoryById.get(id) === 'position') found.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return found;
  };

  return new Map(
    organization.units.map((unit) => {
      const headPositionIds = headPositionsByParent.get(unit.id) ?? [];
      return [
        unit.id,
        {
          parentId: unit.parentId,
          // Có chức danh phụ trách bên dưới cũng tính là "đã có người phụ trách",
          // nếu không thì trách nhiệm sẽ leo lên cấp trên một cách vô cớ.
          hasHead: Boolean(unit.headMembershipId) || headPositionIds.length > 0,
          category: unit.typeCategory,
          headPositionIds,
          memberPositionIds: unit.typeCategory === 'unit' ? descendantPositions(unit.id) : [],
        },
      ];
    }),
  );
}
