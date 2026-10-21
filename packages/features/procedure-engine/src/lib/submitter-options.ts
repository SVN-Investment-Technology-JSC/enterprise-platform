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
  const seen = new Set<string>();
  const people: SubmitterOption[] = [];
  for (const member of organization?.members ?? []) {
    if (seen.has(member.userId)) continue;
    seen.add(member.userId);
    people.push({ userId: member.userId, name: member.displayName, hint: member.positionName });
  }
  people.sort((left, right) => left.name.localeCompare(right.name, 'vi'));
  if (!actor?.id) return people;
  const mine = people.find((person) => person.userId === actor.id) ?? {
    userId: actor.id,
    name: actor.name || actor.id,
  };
  return [mine, ...people.filter((person) => person.userId !== actor.id)];
}
