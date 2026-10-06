/**
 * Phân giải "bước này đang giao cho ai" thành danh sách người dùng cụ thể.
 *
 * Quy trình gán vai cho người, chức danh hoặc đơn vị tổ chức; thông báo thì chỉ gửi được cho người.
 * Quy tắc khớp lặp lại đúng `matchesProcedureAssignment` của module Quy trình
 * (packages/modules/procedure-engine/src/lib/domain/procedure-authorization.ts):
 *  - user: chính người đó;
 *  - position: người giữ chức danh đó;
 *  - organization_unit: vai S giao cho mọi chức danh trong đơn vị, các vai còn lại giao cho
 *    chức danh phụ trách đơn vị; đơn vị chưa có người phụ trách thì leo lên đơn vị cha gần nhất có.
 *
 * Không import `contracts-organization` (thuộc scope nền tảng, module không được phụ thuộc): payload
 * ngữ cảnh tổ chức được đọc như `unknown`, chỉ lấy đúng các trường cần. Hợp đồng đổi thì danh sách
 * người nhận thu hẹp chứ không làm vỡ tiến trình.
 */
export interface ProcedureAssignmentRef {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly role: string;
}

interface OrgUnit {
  readonly parentId?: string;
  readonly hasHead: boolean;
  readonly category?: string;
  readonly headPositionIds: readonly string[];
  readonly memberPositionIds: readonly string[];
}

interface MemberSubjects {
  readonly userId: string;
  readonly organizationUnitIds: readonly string[];
  readonly positionIds: readonly string[];
}

export function resolveProcedureAssigneeUserIds(
  assignments: readonly ProcedureAssignmentRef[],
  organization: unknown,
): string[] {
  const result = new Set<string>();
  const pending: ProcedureAssignmentRef[] = [];
  for (const assignment of assignments) {
    if (assignment.subjectType === 'user') result.add(assignment.subjectId);
    else pending.push(assignment);
  }
  if (pending.length === 0) return [...result];

  const units = buildOrgUnits(organization);
  for (const member of memberSubjects(organization)) {
    if (pending.some((assignment) => matches(assignment, member, units))) result.add(member.userId);
  }
  return [...result];
}

function matches(
  assignment: ProcedureAssignmentRef,
  member: MemberSubjects,
  units: ReadonlyMap<string, OrgUnit>,
): boolean {
  if (assignment.subjectType === 'organization_unit') {
    const acting = actingSubjectIds(assignment.subjectId, units, assignment.role);
    if (acting.some((id) => member.organizationUnitIds.includes(id))) return true;
    // Đơn vị chưa có người phụ trách: đơn vị cha gần nhất có người phụ trách chịu trách nhiệm thay.
    const escalated = escalatedUnitId(assignment.subjectId, units);
    if (escalated === assignment.subjectId) return false;
    return actingSubjectIds(escalated, units, assignment.role).some((id) =>
      member.organizationUnitIds.includes(id),
    );
  }
  return member.positionIds.includes(assignment.subjectId);
}

function actingSubjectIds(
  subjectId: string,
  units: ReadonlyMap<string, OrgUnit>,
  role: string,
): readonly string[] {
  const unit = units.get(subjectId);
  if (!unit || unit.category !== 'unit') return [subjectId];
  const targets = role === 'S' ? unit.memberPositionIds : unit.headPositionIds;
  return targets.length > 0 ? [subjectId, ...targets] : [subjectId];
}

function escalatedUnitId(unitId: string, units: ReadonlyMap<string, OrgUnit>): string {
  const seen = new Set<string>([unitId]);
  let currentId = unitId;
  while (true) {
    const unit = units.get(currentId);
    if (!unit || unit.hasHead) return currentId;
    const parentId = unit.parentId;
    if (!parentId || seen.has(parentId)) return currentId;
    seen.add(parentId);
    currentId = parentId;
  }
}

function buildOrgUnits(organization: unknown): Map<string, OrgUnit> {
  const root = asRecord(organization);
  const nodes = records(root?.['units']);
  const members = records(root?.['members']);

  const headedNodeIds = new Set(
    members.flatMap((member) => {
      const unitId = text(member['unitId']);
      return member['isHead'] === true && unitId ? [unitId] : [];
    }),
  );
  const category = new Map(nodes.map((node) => [text(node['id']) ?? '', text(node['typeCategory'])]));

  const headPositionsByParent = new Map<string, string[]>();
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    const id = text(node['id']);
    const parentId = text(node['parentId']);
    if (!id || !parentId) continue;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), id]);
    if (text(node['typeCategory']) === 'position' && headedNodeIds.has(id)) {
      headPositionsByParent.set(parentId, [...(headPositionsByParent.get(parentId) ?? []), id]);
    }
  }

  const descendantPositions = (rootId: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue; // một bản ghi hỏng không được làm treo tiến trình
      seen.add(id);
      if (category.get(id) === 'position') found.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return found;
  };

  const result = new Map<string, OrgUnit>();
  for (const node of nodes) {
    const id = text(node['id']);
    if (!id) continue;
    const headPositionIds = headPositionsByParent.get(id) ?? [];
    const nodeCategory = text(node['typeCategory']);
    result.set(id, {
      ...(text(node['parentId']) ? { parentId: text(node['parentId']) } : {}),
      hasHead: Boolean(text(node['headMembershipId'])) || headPositionIds.length > 0,
      category: nodeCategory,
      headPositionIds,
      memberPositionIds: nodeCategory === 'unit' ? descendantPositions(id) : [],
    });
  }
  return result;
}

function memberSubjects(organization: unknown): MemberSubjects[] {
  const root = asRecord(organization);
  const subjects = asRecord(root?.['membershipSubjects']) ?? {};
  const seen = new Set<string>();
  const result: MemberSubjects[] = [];
  for (const member of records(root?.['members'])) {
    const membershipId = text(member['membershipId']);
    const userId = text(member['userId']);
    if (!membershipId || !userId || seen.has(membershipId)) continue;
    seen.add(membershipId);
    const entry = asRecord(subjects[membershipId]);
    result.push({
      userId,
      organizationUnitIds: strings(entry?.['organizationUnitIds']),
      positionIds: strings(entry?.['positionIds']),
    });
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
