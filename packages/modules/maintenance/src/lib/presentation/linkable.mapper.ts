import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
} from '@enterprise-platform/contracts-integration';
import type {
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';

/**
 * Bảo trì công bố phiếu bảo trì cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà service sẵn có đã trả; không đọc thêm gì. `label` chỉ gồm mã, tiêu đề (và ngày đến hạn với
 * phiếu định kỳ vì phiếu định kỳ không có mã), không chứa số tiền.
 *
 * Lịch bảo trì (kế hoạch) chưa có màn chi tiết riêng, chỉ có bảng ở trang Lịch bảo trì, nên chưa công bố.
 */
export const MAINTENANCE_LINKABLE_KINDS = {
  occurrence: 'maintenance.occurrence',
} as const;

export type MaintenanceLinkableKind = (typeof MAINTENANCE_LINKABLE_KINDS)[keyof typeof MAINTENANCE_LINKABLE_KINDS];

const MODULE_LABEL = 'Bảo trì';

/** Mọi người vào được Bảo trì (`maintenance.read`) đều xem được phiếu, nên danh sách loại không lọc thêm. */
export const MAINTENANCE_LINKABLE_KIND_LIST: readonly LinkableKind[] = [
  { key: MAINTENANCE_LINKABLE_KINDS.occurrence, moduleLabel: MODULE_LABEL, label: 'Phiếu bảo trì', prefill: false },
];

export function isMaintenanceLinkableKind(value: unknown): value is MaintenanceLinkableKind {
  return MAINTENANCE_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

/** Trang Lịch sử mở thẳng chi tiết phiếu bằng hash `#history/<id>`. */
export function occurrenceLaunchUrl(id: string): string {
  return `/modules/maintenance#history/${encodeURIComponent(id)}`;
}

/** Cùng nhãn với màn Bảo trì. */
const STATUS_LABELS: Readonly<Record<MaintenanceOccurrenceStatus, string>> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

const KIND_LABELS: Readonly<Record<MaintenanceOccurrenceKind, string>> = {
  preventive: 'Bảo trì định kỳ',
  incident: 'Sự cố đột xuất',
};

const PRIORITY_LABELS: Readonly<Record<MaintenancePriority, string>> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

const joined = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
/** Ngày (giờ Việt Nam) của một mốc thời gian ISO: phiếu đến hạn 00:00 ngày 1 không bị lùi về ngày 30 theo UTC. */
const VIETNAM_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value.slice(0, 10) : VIETNAM_DAY.format(at);
}
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: day(value),
});
const assetText = (row: MaintenanceOccurrence) => joined(row.assetCode, row.assetName);

/* ------------------------------------------------------------------ Phiếu bảo trì */

/** Phiếu định kỳ không có mã và trùng tiêu đề với lịch cha: thêm ngày đến hạn để phân biệt. */
function occurrenceLabel(row: MaintenanceOccurrence): string {
  if (row.code) return joined(row.code, row.title);
  const due = day(row.dueAt);
  return due ? `${row.title} (${due})` : row.title;
}

export function occurrenceCandidate(row: MaintenanceOccurrence): LinkableCandidate {
  return {
    kind: MAINTENANCE_LINKABLE_KINDS.occurrence,
    id: row.id,
    code: row.code,
    label: occurrenceLabel(row),
    status: STATUS_LABELS[row.status] ?? row.status,
    hint: joined(KIND_LABELS[row.kind] ?? row.kind, assetText(row)),
  };
}

export function occurrenceObject(row: MaintenanceOccurrence): LinkableObject {
  return {
    ...occurrenceCandidate(row),
    launchUrl: occurrenceLaunchUrl(row.id),
    fields: [
      text('kind', 'Loại phiếu', KIND_LABELS[row.kind] ?? row.kind),
      text('asset', 'Thiết bị', assetText(row)),
      text('schedule', 'Lịch bảo trì', row.scheduleTitle),
      date('dueAt', 'Đến hạn', row.dueAt),
      text('priority', 'Ưu tiên', PRIORITY_LABELS[row.priority] ?? row.priority),
      text('status', 'Trạng thái', STATUS_LABELS[row.status] ?? row.status),
      text('assignee', 'Người phụ trách', row.assigneeName),
      text('procedure', 'Hồ sơ quy trình', row.procedureInstanceCode),
      text('createdBy', 'Người tạo', row.createdByName),
      date('createdAt', 'Ngày tạo', row.createdAt),
      date('completedAt', 'Ngày hoàn thành', row.completedAt),
      text('completedBy', 'Người hoàn thành', row.completedByName),
      text('description', 'Mô tả', row.description),
      text('completionNote', 'Ghi chú hoàn thành', row.completionNote),
    ],
    upstream: [],
  };
}

/**
 * Tìm trong danh sách phiếu mà màn Bảo trì đã tải (`workspace`): khớp mã, tiêu đề, thiết bị, lịch hay mã hồ sơ quy
 * trình (không phân biệt hoa thường, dấu); mới tạo trước. Không có chữ thì trả các phiếu mới tạo nhất.
 */
export function searchOccurrences(
  rows: readonly MaintenanceOccurrence[],
  q: string | undefined,
  limit: number,
): MaintenanceOccurrence[] {
  const needle = q ? fold(q) : '';
  const matched = needle
    ? rows.filter((row) =>
        [row.code, row.title, row.assetCode, row.assetName, row.scheduleTitle, row.procedureInstanceCode].some(
          (value) => value != null && fold(value).includes(needle),
        ),
      )
    : [...rows];
  return matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
