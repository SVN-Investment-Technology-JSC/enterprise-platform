import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';

/** Một người có thể được `@` trong trao đổi của hồ sơ. `id` là id người dùng thật. */
export interface ChatPerson {
  readonly id: string;
  /** Tên dùng trong nội dung tin (`@Họ Tên`); trùng tên hiển thị thì có thêm đuôi để phân biệt. */
  readonly name: string;
  /** Chức danh/đơn vị, để người dùng phân biệt khi nhiều người gần giống nhau. */
  readonly hint?: string;
}

/**
 * Những NGƯỜI có thể được nhắc trong trao đổi của một hồ sơ.
 *
 * Vai trong hồ sơ được giao cho chức danh hoặc đơn vị chứ không cho người cụ thể, nên trước đây `@` nhắc
 * nguyên một chức danh (nhãn là danh sách người đang giữ ghép lại) và `mentions` gửi đi là id chức danh.
 * Ở đây mở rộng ra từng người đang giữ thật sự, bám theo luật "ai là người tham gia" của máy chủ:
 * - người khởi tạo;
 * - vai giao thẳng cho người;
 * - vai giao cho chức danh: mọi người đang giữ chức danh đó;
 * - vai giao cho đơn vị: trưởng đơn vị, hoặc nếu đơn vị chưa có trưởng thì trưởng của đơn vị gần nhất phía trên;
 * - vai "quản lý trực tiếp" đã được giải ra người/chức danh lúc chạy (`resolutions`);
 * - người được ủy quyền và người nhận việc con.
 * "Toàn bộ nhân viên" không có quyền đọc hồ sơ của người khác nên không được liệt kê.
 *
 * Đây chỉ để gợi ý: máy chủ vẫn là nơi quyết định ai gửi/đọc được trao đổi.
 */
export function chatPeopleOf(
  instance: ProcedureInstance,
  organization?: TenantOrganizationSnapshot,
  excludeUserId?: string,
): ChatPerson[] {
  const members = organization?.members ?? [];
  const units = new Map((organization?.units ?? []).map((unit) => [unit.id, unit]));
  const nameOfUser = new Map(members.map((member) => [member.userId, member]));

  const found = new Map<string, { name: string; hint?: string }>();
  const add = (userId: string | undefined, fallbackName?: string, hint?: string) => {
    if (!userId || userId === excludeUserId || found.has(userId)) return;
    const member = nameOfUser.get(userId);
    const name = member?.displayName?.trim() || fallbackName?.trim();
    if (!name) return;
    found.set(userId, { name, hint: hint ?? member?.positionName });
  };

  const holdersOfPosition = (positionId: string) =>
    members.filter((member) => member.positionId === positionId);

  /** Trưởng đơn vị; đơn vị chưa có trưởng thì leo lên đơn vị cha gần nhất có trưởng (chặn vòng lặp). */
  const headsOfUnit = (unitId: string) => {
    const seen = new Set<string>();
    let current: string | undefined = unitId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const heads = members.filter((member) => member.unitId === current && member.isHead);
      if (heads.length > 0) return heads;
      current = units.get(current)?.parentId;
    }
    return [];
  };

  // Hồ sơ không lưu tên người khởi tạo: lấy từ sơ đồ tổ chức, rơi về tên trong nhật ký thao tác của chính họ.
  add(
    instance.initiatedBy,
    instance.activity.find((entry) => entry.actorId === instance.initiatedBy)?.actorName,
    'Người khởi tạo',
  );
  for (const step of instance.steps) {
    for (const assignment of step.assignments) {
      if (assignment.subjectType === 'user') {
        add(assignment.subjectId, assignment.subjectLabel);
      } else if (assignment.subjectType === 'position') {
        for (const member of holdersOfPosition(assignment.subjectId)) add(member.userId, member.displayName);
      } else if (assignment.subjectType === 'organization_unit') {
        for (const member of headsOfUnit(assignment.subjectId)) add(member.userId, member.displayName);
      }
    }
    for (const resolution of step.resolutions ?? []) {
      const target = resolution.resolvedTo;
      if (target.subjectType === 'user') add(target.subjectId, target.label);
      else if (target.subjectType === 'position') {
        for (const member of holdersOfPosition(target.subjectId)) add(member.userId, member.displayName);
      } else {
        for (const member of headsOfUnit(target.subjectId)) add(member.userId, member.displayName);
      }
    }
  }
  for (const delegation of instance.delegations ?? []) add(delegation.delegatedTo);
  for (const subtask of instance.subtasks ?? []) add(subtask.assigneeId, subtask.assigneeName);

  // Hai người trùng tên hiển thị thì thêm đuôi từ id, để `@Tên` luôn chỉ đúng MỘT người (nếu không, nhắc một
  // người sẽ báo nhầm cả người cùng tên).
  const counts = new Map<string, number>();
  for (const { name } of found.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...found].map(([id, { name, hint }]) => ({
    id,
    name: (counts.get(name) ?? 0) > 1 ? `${name} #${id.slice(0, 4)}` : name,
    hint,
  }));
}
