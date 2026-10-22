import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';

/** Một người chọn được ở ô "Người submit". */
export interface SubmitterOption {
  readonly userId: string;
  readonly name: string;
  readonly hint?: string;
}

/**
 * Mọi người trong tenant (theo sơ đồ tổ chức), mỗi người một dòng, người đang tạo đơn đứng đầu. Ai làm
 * người submit cũng được: máy chủ chỉ cần người tạo hoặc người submit giữ vai S của quy trình.
 */
export function submitterOptionsOf(
  organization: TenantOrganizationSnapshot | undefined,
  actor?: { readonly id?: string; readonly name?: string },
): SubmitterOption[] {
  const unitName = new Map((organization?.units ?? []).map((unit) => [unit.id, unit.name]));
  // Một người kiêm nhiều chức danh / bộ phận vẫn chỉ một dòng; dòng phụ gộp đủ chức danh rồi bộ phận.
  const byUser = new Map<string, { name: string; positions: Set<string>; units: Set<string> }>();
  for (const member of organization?.members ?? []) {
    const entry = byUser.get(member.userId) ?? {
      name: member.displayName,
      positions: new Set<string>(),
      units: new Set<string>(),
    };
    if (member.positionName) entry.positions.add(member.positionName);
    const unit = member.unitId ? unitName.get(member.unitId) : undefined;
    if (unit) entry.units.add(unit);
    byUser.set(member.userId, entry);
  }
  const people: SubmitterOption[] = [...byUser].map(([userId, entry]) => {
    const hint = [[...entry.positions].join(', '), [...entry.units].join(', ')].filter(Boolean).join(' · ');
    return hint ? { userId, name: entry.name, hint } : { userId, name: entry.name };
  });
  people.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
  if (!actor?.id) return people;
  const mine = people.find((person) => person.userId === actor.id) ?? {
    userId: actor.id,
    name: actor.name || actor.id,
  };
  return [mine, ...people.filter((person) => person.userId !== actor.id)];
}
