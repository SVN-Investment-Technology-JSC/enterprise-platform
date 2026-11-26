import {
  type RelatedObject,
  type RelatedObjectField,
  type RelatedObjectUnavailableReason,
} from '@enterprise-platform/contracts-workspace';
import { formatDate } from '@enterprise-platform/shared-ui';
import { formatVnd } from './money';

/*
 * Logic thuần của "Đối tượng liên quan": dòng chờ gắn trong form (tạo và sửa), và cách tab "Liên quan" lọc, gom
 * nhóm, hiển thị. Không gọi API ở đây; phần gọi API nằm ở `related-objects-link.ts`.
 */

/* ------------------------------------------------------------ Dòng chờ gắn */

/**
 * Một dòng trong khối "Đối tượng liên quan" của form, chưa gửi lên server.
 * `objectId` rỗng: dòng mới chọn loại, chưa chọn hồ sơ (bỏ qua khi lưu).
 */
export interface PendingRelatedObject {
  /** Khoá riêng của dòng trong danh sách (React key), không gửi lên server. */
  readonly key: string;
  readonly kind: string;
  readonly objectId: string;
  /** Nhãn đã hiển thị (mã — tên) của hồ sơ đã chọn, để ô chọn hiện đúng mà không phải tìm lại. */
  readonly label: string;
  /** Tên loại, dùng khi loại không còn trong danh sách loại chọn được. */
  readonly kindLabel?: string;
  /** Liên kết đã lưu (form sửa): id của liên kết; dòng này chỉ xem, không đổi loại hay hồ sơ được. */
  readonly existingId?: string;
  /** Liên kết đã lưu mà người xem gỡ được (nút X). */
  readonly canRemove?: boolean;
}

export type PendingRelatedFields = Omit<PendingRelatedObject, 'key'>;

let lastPendingKey = 0;

/** Dòng mới với khoá riêng; trường nào không truyền thì để trống. */
export function pendingRelatedRow(fields: Partial<PendingRelatedFields> = {}): PendingRelatedObject {
  lastPendingKey += 1;
  return { kind: '', objectId: '', label: '', ...fields, key: `related-${lastPendingKey}` };
}

/** Cùng một hồ sơ: trùng cả loại lẫn id. */
export function sameRelated(
  a: { readonly kind: string; readonly objectId: string },
  b: { readonly kind: string; readonly objectId: string },
): boolean {
  return a.kind === b.kind && a.objectId === b.objectId;
}

/** Các dòng đã chọn đủ loại và hồ sơ, bỏ trùng (giữ dòng đầu): đúng danh sách sẽ gửi lên. */
export function completedRelated(rows: readonly PendingRelatedObject[]): PendingRelatedObject[] {
  const result: PendingRelatedObject[] = [];
  for (const row of rows) {
    if (!row.kind || !row.objectId) continue;
    if (result.some((entry) => sameRelated(entry, row))) continue;
    result.push(row);
  }
  return result;
}

/**
 * Liên kết đã lưu thành dòng của form sửa: chỉ xem (loại và hồ sơ cố định), nút X theo `canRemove`.
 * `entity` lọc đúng liên kết của chính đối tượng đang sửa: danh sách của dự án có cả liên kết gắn ở công việc.
 */
export function existingRelatedRows(
  items: readonly RelatedObject[],
  entity: { readonly type: RelatedObject['entityType']; readonly id: string },
): PendingRelatedObject[] {
  return items
    .filter((item) => item.entityType === entity.type && item.entityId === entity.id)
    .map((item) =>
      pendingRelatedRow({
        kind: item.kind,
        objectId: item.objectId,
        label: relatedDisplayLabel(item.code, item.label),
        kindLabel: relatedGroupLabel(item),
        existingId: item.id,
        canRemove: item.canRemove,
      }),
    );
}

/**
 * Việc phải làm khi lưu form sửa: dòng mới (chưa có `existingId`) cần gắn, liên kết đã lưu bị bỏ cần gỡ. Bỏ một liên
 * kết rồi thêm lại đúng hồ sơ đó thì coi như không đổi gì.
 */
export function relatedChanges(
  initial: readonly PendingRelatedObject[],
  current: readonly PendingRelatedObject[],
): { readonly added: PendingRelatedObject[]; readonly removed: PendingRelatedObject[] } {
  const kept = current.filter((row) => row.existingId);
  const fresh = completedRelated(current.filter((row) => !row.existingId)).filter(
    (row) => !kept.some((entry) => sameRelated(entry, row)),
  );
  const dropped = initial.filter(
    (row) => row.existingId && !kept.some((entry) => entry.existingId === row.existingId),
  );
  return {
    added: fresh.filter((row) => !dropped.some((entry) => sameRelated(entry, row))),
    removed: dropped.filter((row) => !fresh.some((entry) => sameRelated(entry, row))),
  };
}

/* ------------------------------------------------------------ Nhãn hiển thị */

const fold = (text: string) => text.trim().toLocaleLowerCase('vi');

/**
 * "Mã — tên" của một hồ sơ. Module gốc thường đã ghép mã vào nhãn ("HĐ-001 · Công trình A"); khi đó không
 * lặp lại mã.
 */
export function relatedDisplayLabel(code: string | undefined, label: string): string {
  const text = label.trim();
  const prefix = code?.trim();
  if (!prefix) return text;
  if (!text) return prefix;
  return fold(text).startsWith(fold(prefix)) ? text : `${prefix} — ${text}`;
}

/** Dòng phụ dưới mỗi hồ sơ trong ô chọn: gợi ý phân biệt (vd tên khách) và trạng thái. */
export function candidateDescription(hint?: string, status?: string): string | undefined {
  const parts = [hint?.trim(), status?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/* ------------------------------------------------------------ Lỗi khi gắn */

export interface RelatedLinkFailure {
  readonly item: PendingRelatedObject;
  readonly message: string;
}

const trimSentence = (text: string) => text.trim().replace(/[.\s]+$/, '');

/**
 * Lời báo (không chặn) khi tạo xong dự án hay công việc nhưng một số đối tượng liên quan chưa gắn được.
 * `target` ví dụ "dự án DA-001"; `retryHint` thêm câu chỉ chỗ gắn lại.
 */
export function relatedLinkWarning(
  failures: readonly RelatedLinkFailure[],
  target?: string,
  retryHint = true,
): string {
  const list = failures
    .map((failure) => `${failure.item.label || failure.item.objectId} (${trimSentence(failure.message) || 'lỗi không rõ'})`)
    .join('; ');
  const where = target ? ` vào ${target}` : '';
  const hint = retryHint ? ' Có thể gắn lại ở tab Liên quan của dự án.' : '';
  return `Chưa gắn được ${failures.length} đối tượng liên quan${where}: ${list}.${hint}`;
}

/** Lời báo (không chặn) khi lưu form sửa mà một số liên kết chưa gỡ được. */
export function relatedUnlinkWarning(failures: readonly RelatedLinkFailure[], target?: string): string {
  const list = failures
    .map((failure) => `${failure.item.label || failure.item.objectId} (${trimSentence(failure.message) || 'lỗi không rõ'})`)
    .join('; ');
  return `Chưa gỡ được ${failures.length} đối tượng liên quan${target ? ` khỏi ${target}` : ''}: ${list}.`;
}

/* ------------------------------------------------------------ Tab "Liên quan" */

/** Ghi chú khi không đọc được thông tin đầy đủ từ module gốc. */
export const RELATED_UNAVAILABLE_NOTES: Readonly<Record<RelatedObjectUnavailableReason, string>> = {
  module_unavailable: 'Không còn mở được hồ sơ này',
  forbidden: 'Bạn không có quyền xem chi tiết',
  not_found: 'Hồ sơ đã bị xoá',
  unreachable: 'Tạm thời chưa tải được thông tin',
};

/** Chỉ nhận đường dẫn nội bộ (`/modules/...`): không mở `javascript:` hay một host khác do dữ liệu lạ đưa vào. */
export function safeLaunchUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const value = url.trim();
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : undefined;
}

/** Đường mở hồ sơ gốc; không có khi module gốc không cho xem (chỉ "chưa phản hồi" vẫn thử mở được). */
export function relatedLaunchHref(item: Pick<RelatedObject, 'launchUrl' | 'unavailableReason'>): string | undefined {
  if (item.unavailableReason && item.unavailableReason !== 'unreachable') return undefined;
  return safeLaunchUrl(item.launchUrl);
}

/** Giá trị một dòng thông tin theo kiểu: tiền "1.200.000 ₫", ngày "dd/mm/yyyy", chữ giữ nguyên, trống là "—". */
export function formatRelatedFieldValue(field: Pick<RelatedObjectField, 'type' | 'value'>): string {
  const { value } = field;
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return '—';
  if (field.type === 'money') {
    const amount = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(amount) ? formatVnd(amount) : String(value);
  }
  if (field.type === 'date') return formatDate(String(value), String(value));
  return String(value);
}

/** Tên loại của một liên kết, cũng là tên nhóm trong tab: "Báo giá". Người dùng không cần biết hồ sơ ở phân hệ nào. */
export function relatedGroupLabel(item: Pick<RelatedObject, 'kindLabel'>): string {
  return item.kindLabel?.trim() || 'Hồ sơ khác';
}

export interface RelatedGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly RelatedObject[];
}

/** Gom theo loại, nhóm xếp theo tên loại; trong nhóm giữ thứ tự server trả. */
export function groupRelatedObjects(items: readonly RelatedObject[]): RelatedGroup[] {
  const groups = new Map<string, { label: string; items: RelatedObject[] }>();
  for (const item of items) {
    const group = groups.get(item.kind);
    if (group) group.items.push(item);
    else groups.set(item.kind, { label: relatedGroupLabel(item), items: [item] });
  }
  return [...groups]
    .map(([key, group]) => ({ key, label: group.label, items: group.items }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

/** Giá trị "tất cả" của hai ô lọc, và giá trị "gắn ở dự án" của ô Gắn vào. */
export const RELATED_FILTER_ALL = 'all';
export const RELATED_ATTACHED_PROJECT = 'project';

export interface RelatedFilter {
  /** Khoá loại, hoặc `RELATED_FILTER_ALL`. */
  readonly kind: string;
  /** `RELATED_ATTACHED_PROJECT`, id công việc, hoặc `RELATED_FILTER_ALL`. */
  readonly attached: string;
}

export const NO_RELATED_FILTER: RelatedFilter = { kind: RELATED_FILTER_ALL, attached: RELATED_FILTER_ALL };

export function filterRelatedObjects(items: readonly RelatedObject[], filter: RelatedFilter): RelatedObject[] {
  return items.filter((item) => {
    if (filter.kind !== RELATED_FILTER_ALL && item.kind !== filter.kind) return false;
    if (filter.attached === RELATED_FILTER_ALL) return true;
    if (filter.attached === RELATED_ATTACHED_PROJECT) return item.entityType === 'project';
    return item.entityType === 'work_item' && item.entityId === filter.attached;
  });
}

/** Lựa chọn của ô lọc loại: các loại đang có trong danh sách. */
export function relatedKindOptions(items: readonly RelatedObject[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const item of items) if (!seen.has(item.kind)) seen.set(item.kind, relatedGroupLabel(item));
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

/** Liên kết gắn ở đâu: "Dự án", hoặc mã và tên công việc. */
export function attachedToLabel(
  item: Pick<RelatedObject, 'entityType' | 'entityId' | 'entityLabel'>,
  workItemLabel?: (workItemId: string) => string | undefined,
): string {
  if (item.entityType === 'project') return 'Dự án';
  return item.entityLabel?.trim() || workItemLabel?.(item.entityId) || 'Công việc';
}

/** Lựa chọn của ô lọc "Gắn vào": dự án, rồi các công việc đang có liên kết (xếp theo nhãn). */
export function relatedAttachedOptions(
  items: readonly RelatedObject[],
  workItemLabel?: (workItemId: string) => string | undefined,
): { value: string; label: string }[] {
  const workItems = new Map<string, string>();
  for (const item of items) {
    if (item.entityType !== 'work_item' || workItems.has(item.entityId)) continue;
    workItems.set(item.entityId, attachedToLabel(item, workItemLabel));
  }
  return [
    { value: RELATED_ATTACHED_PROJECT, label: 'Dự án' },
    ...[...workItems]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi', { numeric: true })),
  ];
}
