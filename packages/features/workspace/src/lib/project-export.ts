import type { ProjectMember, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { progressMethodLabel } from './project-progress-methods';
import { PROJECT_STATUS_LABELS } from './workspace-labels';

/**
 * Xuất danh sách dự án ra Excel theo mẫu của 1office (hàng tiêu đề ở dòng 1, mỗi dự án một dòng, ngày dạng
 * `dd/mm/yyyy`, ngày giờ dạng `HH:mm dd/mm/yyyy`). Chỉ có cột mà hệ thống này có dữ liệu thật; cột 1office có mà ở đây
 * chưa có khái niệm (ngày bắt đầu/kết thúc thực tế, thảo luận, số tệp đính kèm, các tuỳ chọn riêng của 1office) thì không
 * xuất, để khỏi có cột trống.
 */

/** Dữ liệu tra cứu kèm theo dự án khi dựng một dòng. */
export interface ProjectExportLookups {
  readonly personName: (userId: string | undefined) => string;
  readonly orgUnitName: (orgUnitId: string | undefined) => string;
  readonly customerName: (customerId: string | undefined) => string;
  readonly tagName: (tagId: string) => string;
  /** Thành viên theo dự án; chỉ có khi đã nạp (cột cần thành viên). */
  readonly membersOf: (projectId: string) => readonly ProjectMember[] | undefined;
}

export type ProjectExportCell = string | number;

export interface ProjectExportColumn {
  readonly key: string;
  /** Tên cột trong file: theo đúng tên cột của 1office. */
  readonly label: string;
  /** Cột này cần danh sách thành viên của từng dự án (phải gọi thêm API). */
  readonly needsMembers?: boolean;
  readonly value: (project: ProjectSummary, lookups: ProjectExportLookups) => ProjectExportCell;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-07-01` (hay ISO đầy đủ) → `01/07/2026`; rỗng khi không có ngày. */
export function exportDate(value?: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

/** Mốc thời gian ISO → `HH:mm dd/mm/yyyy` theo giờ máy người xuất. */
export function exportDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Số ngày của dự án, tính cả ngày đầu và ngày cuối ("01/01 → 31/12" là 365 ngày); rỗng khi thiếu hay ngược ngày. */
export function projectDays(project: Pick<ProjectSummary, 'startDate' | 'endDate'>): number | undefined {
  if (!project.startDate || !project.endDate) return undefined;
  const start = Date.parse(`${project.startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${project.endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return Math.round((end - start) / 86_400_000) + 1;
}

const names = (ids: readonly string[], lookups: ProjectExportLookups) =>
  [...new Set(ids.map((id) => lookups.personName(id)).filter((name) => name && name !== '—'))].join(', ');

/** Mọi cột có thể xuất, theo thứ tự của mẫu 1office. */
export const PROJECT_EXPORT_COLUMNS: readonly ProjectExportColumn[] = [
  { key: 'name', label: 'Tên dự án', value: (project) => project.name },
  { key: 'code', label: 'Mã dự án', value: (project) => project.code },
  { key: 'startDate', label: 'Bắt đầu', value: (project) => exportDate(project.startDate) },
  { key: 'endDate', label: 'Kết thúc', value: (project) => exportDate(project.endDate) },
  { key: 'status', label: 'Trạng thái', value: (project) => PROJECT_STATUS_LABELS[project.status] ?? project.status },
  { key: 'createdAt', label: 'Ngày tạo', value: (project) => exportDateTime(project.createdAt) },
  { key: 'updatedAt', label: 'Ngày cập nhật', value: (project) => exportDateTime(project.updatedAt) },
  { key: 'items', label: 'Công việc', value: (project) => project.totalItems },
  {
    key: 'memberCount',
    label: 'Số người',
    needsMembers: true,
    value: (project, lookups) => lookups.membersOf(project.id)?.length ?? '',
  },
  {
    key: 'members',
    label: 'Người tham gia',
    needsMembers: true,
    value: (project, lookups) => names((lookups.membersOf(project.id) ?? []).map((member) => member.userId), lookups),
  },
  { key: 'owner', label: 'Người quản trị', value: (project, lookups) => names([project.ownerUserId], lookups) },
  {
    key: 'days',
    label: 'Số ngày',
    value: (project) => {
      const days = projectDays(project);
      return days === undefined ? '' : `${days} ngày`;
    },
  },
  { key: 'description', label: 'Mô tả', value: (project) => project.description ?? '' },
  { key: 'creator', label: 'Người tạo', value: (project, lookups) => names([project.createdBy], lookups) },
  { key: 'progress', label: 'Tiến độ', value: (project) => `${Math.round(project.progressPercent ?? 0)}%` },
  { key: 'progressMethod', label: 'Cách tính tiến độ dự án', value: (project) => progressMethodLabel(project.progressMethod) },
  { key: 'group', label: 'Nhóm dự án', value: (project) => project.projectType ?? '' },
  {
    key: 'contractValue',
    label: 'Tổng giá trị dự án',
    // Số tài chính chỉ có khi người xuất được xem tài chính; không có thì để trống, không đoán.
    value: (project) => project.contractValue ?? project.finance?.contractValue ?? '',
  },
  {
    key: 'tags',
    label: 'Nhãn',
    value: (project, lookups) =>
      (project.tagIds ?? [])
        .map((tagId) => lookups.tagName(tagId))
        .filter(Boolean)
        .join(', '),
  },
  { key: 'orgUnit', label: 'Phòng ban phụ trách', value: (project, lookups) => lookups.orgUnitName(project.orgUnitId) },
  {
    key: 'customer',
    label: 'Chủ đầu tư / Đối tác / Khách hàng',
    value: (project, lookups) => lookups.customerName(project.customerId),
  },
];

/** Khoá các cột chọn sẵn khi xuất: tất cả. */
export const DEFAULT_PROJECT_EXPORT_KEYS: readonly string[] = PROJECT_EXPORT_COLUMNS.map((column) => column.key);

/** Cột theo khoá đã chọn, luôn theo thứ tự của mẫu; khoá lạ bị bỏ. */
export function selectedExportColumns(keys: readonly string[]): ProjectExportColumn[] {
  const wanted = new Set(keys);
  return PROJECT_EXPORT_COLUMNS.filter((column) => wanted.has(column.key));
}

/** Có cột nào trong lựa chọn phải nạp thành viên từng dự án không. */
export const needsMembers = (columns: readonly ProjectExportColumn[]): boolean =>
  columns.some((column) => column.needsMembers);

/** Hàng tiêu đề và các dòng dữ liệu của file xuất. */
export function buildProjectExportRows(
  projects: readonly ProjectSummary[],
  columns: readonly ProjectExportColumn[],
  lookups: ProjectExportLookups,
): { headers: string[]; rows: ProjectExportCell[][] } {
  return {
    headers: columns.map((column) => column.label),
    rows: projects.map((project) => columns.map((column) => column.value(project, lookups))),
  };
}

/** `124-ban-ghi-Du-an-ngay-27112026.xlsx`, cùng kiểu đặt tên của 1office. */
export function projectExportFileName(count: number, now: Date = new Date()): string {
  return `${count}-ban-ghi-Du-an-ngay-${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}.xlsx`;
}
