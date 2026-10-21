import {
  TENANT_PERMISSION_ACTIONS,
  type TenantAuthorizationAuditEntry,
} from '@enterprise-platform/contracts-identity';

export type HistoryChangeKind = 'added' | 'removed';

export interface HistoryChange {
  readonly kind: HistoryChangeKind;
  /** Câu hiển thị, ví dụ "Thêm vai trò Kế toán". */
  readonly text: string;
}

export interface HistoryItem {
  readonly id: string;
  readonly operation: 'roles' | 'permissions' | 'other';
  readonly title: string;
  readonly actorName: string;
  readonly createdAt: string;
  readonly changes: readonly HistoryChange[];
}

export const DELETED_ROLE_LABEL = 'Vai trò đã xóa';
export const DELETED_ACTOR_LABEL = 'Người dùng đã bị xóa';

/** Đọc mảng chuỗi ở khóa `key` của trạng thái before/after; dữ liệu lạ thì coi như rỗng. */
function readList(state: unknown, key: 'roleIds' | 'actionKeys'): string[] {
  if (typeof state !== 'object' || state === null) return [];
  const value = (state as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string'))]
    : [];
}

/** Phần tử thêm vào và bị gỡ đi giữa hai danh sách, giữ thứ tự xuất hiện. */
export function diffLists(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)),
    removed: before.filter((x) => !a.has(x)),
  };
}

export function actionLabel(key: string): string {
  return TENANT_PERMISSION_ACTIONS.find((a) => a.key === key)?.label ?? key;
}

function changesOf(
  diff: { added: string[]; removed: string[] },
  noun: string,
  label: (id: string) => string,
): HistoryChange[] {
  return [
    ...diff.added.map(
      (id): HistoryChange => ({
        kind: 'added',
        text: `Thêm ${noun} ${label(id)}`,
      }),
    ),
    ...diff.removed.map(
      (id): HistoryChange => ({
        kind: 'removed',
        text: `Gỡ ${noun} ${label(id)}`,
      }),
    ),
  ];
}

export function describeEntry(
  entry: TenantAuthorizationAuditEntry,
  roleNames: ReadonlyMap<string, string>,
): HistoryItem {
  const base = {
    id: entry.id,
    actorName: entry.actorName ?? DELETED_ACTOR_LABEL,
    createdAt: entry.createdAt,
  };
  if (entry.operation === 'user.roles.replace') {
    const diff = diffLists(
      readList(entry.before, 'roleIds'),
      readList(entry.after, 'roleIds'),
    );
    return {
      ...base,
      operation: 'roles',
      title: 'Thay đổi vai trò',
      changes: changesOf(
        diff,
        'vai trò',
        (id) => roleNames.get(id) ?? DELETED_ROLE_LABEL,
      ),
    };
  }
  if (entry.operation === 'user.permissions.replace') {
    const diff = diffLists(
      readList(entry.before, 'actionKeys'),
      readList(entry.after, 'actionKeys'),
    );
    return {
      ...base,
      operation: 'permissions',
      title: 'Thay đổi quyền bổ sung',
      changes: changesOf(diff, 'quyền bổ sung', actionLabel),
    };
  }
  return {
    ...base,
    operation: 'other',
    title: 'Thay đổi phân quyền',
    changes: [],
  };
}

/** Dòng thời gian: mới nhất trước. */
export function buildHistoryItems(
  entries: readonly TenantAuthorizationAuditEntry[],
  roleNames: ReadonlyMap<string, string>,
): HistoryItem[] {
  return entries
    .map((entry) => describeEntry(entry, roleNames))
    .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
