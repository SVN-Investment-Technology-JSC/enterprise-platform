/**
 * Mô hình thuần (không phụ thuộc giao diện) của màn "Loại đơn & lý do": danh sách loại đơn kèm nguồn lý do của từng loại,
 * lọc theo từ khoá không dấu và theo trạng thái. Tách riêng để kiểm thử mà không cần dựng giao diện.
 */
import type { HrmRequestEngine, HrmRequestType } from '@enterprise-platform/contracts-hrm';

/**
 * Nguồn danh mục lý do của một loại đơn:
 *  - `leave`: lý do nghỉ chính là loại nghỉ (`GET /leave-types`);
 *  - `reasons`: danh mục `GET /request-reasons` theo mã loại (4 loại hệ thống có lý do và mọi loại tuỳ chỉnh);
 *  - `none`: không có danh mục lý do (tạm ứng lương, đính chính hồ sơ).
 */
export type ReasonCatalog = 'leave' | 'reasons' | 'none';

export interface CatalogType {
  /** Mã loại đơn; cũng là `kind` của lý do (loại `reasons`) và giá trị `?tab=` trên đường dẫn. */
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly engine: HrmRequestEngine;
  readonly catalog: ReasonCatalog;
  /** Loại do quản trị tạo (không phải loại hệ thống). */
  readonly custom: boolean;
  readonly active: boolean;
  /** Bản ghi đầy đủ của `GET /request-types/manage`; null khi danh mục loại đơn không tải được. */
  readonly record: HrmRequestType | null;
}

/** Mã loại đơn mặc định (loại đầu tiên): lý do nghỉ. */
export const DEFAULT_TYPE_CODE = 'LEAVE';

/** Tên loại Nghỉ phép khi chưa tải được danh mục loại đơn (trùng tên loại hệ thống). */
const FALLBACK_LEAVE_NAME = 'Nghỉ phép';

export function catalogOf(engine: HrmRequestEngine): ReasonCatalog {
  if (engine === 'LEAVE') return 'leave';
  if (engine === 'ADVANCE' || engine === 'PROFILE_CORRECTION') return 'none';
  return 'reasons';
}

/**
 * Danh sách loại đơn theo đúng thứ tự máy chủ trả về (hệ thống rồi tuỳ chỉnh).
 * Chưa tải được danh mục loại đơn (`types` là null) thì chỉ còn Nghỉ phép và các loại hệ thống có lý do (`systemKinds`).
 */
export function buildCatalogTypes(
  types: readonly HrmRequestType[] | null,
  systemKinds: readonly { readonly kind: string; readonly label: string }[],
): CatalogType[] {
  if (types) {
    return types.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description ?? null,
      engine: t.engine,
      catalog: catalogOf(t.engine),
      custom: !t.isSystem,
      active: t.active,
      record: t,
    }));
  }
  return [
    {
      code: DEFAULT_TYPE_CODE,
      name: FALLBACK_LEAVE_NAME,
      description: null,
      engine: 'LEAVE',
      catalog: 'leave',
      custom: false,
      active: true,
      record: null,
    },
    ...systemKinds.map((k) => ({
      code: k.kind,
      name: k.label,
      description: null,
      engine: k.kind as HrmRequestEngine,
      catalog: 'reasons' as const,
      custom: false,
      active: true,
      record: null,
    })),
  ];
}

/** Loại đang chọn theo mã yêu cầu (không phân biệt hoa thường); mã lạ hoặc trống thì rơi về loại đầu tiên. */
export function resolveCatalogType(
  entries: readonly CatalogType[],
  requested: string | null | undefined,
): CatalogType | undefined {
  const wanted = (requested ?? '').trim().toUpperCase();
  return (wanted ? entries.find((e) => e.code.toUpperCase() === wanted) : undefined) ?? entries[0];
}

/** Bỏ dấu tiếng Việt, chữ thường: để tìm "nghi phep" ra "Nghỉ phép". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Từ khoá rỗng thì khớp tất cả; ngược lại khớp khi có BẤT KỲ trường nào chứa từ khoá (không dấu). */
export function matchesQuery(query: string, ...values: readonly (string | null | undefined)[]): boolean {
  const needle = foldText(query);
  if (!needle) return true;
  return values.some((v) => (v ? foldText(v).includes(needle) : false));
}

export type StatusFilter = 'all' | 'active' | 'inactive' | 'merged';

export const STATUS_FILTER_VALUES: readonly StatusFilter[] = ['all', 'active', 'inactive', 'merged'];

/** Lọc theo trạng thái; dòng đã gộp (loại nghỉ) chỉ khớp bộ lọc "Đã gộp", không lẫn vào "Ngừng sử dụng". */
export function matchesStatus(filter: StatusFilter, row: { active: boolean; merged?: boolean }): boolean {
  if (filter === 'all') return true;
  if (filter === 'merged') return Boolean(row.merged);
  if (filter === 'active') return row.active && !row.merged;
  return !row.active && !row.merged;
}

export function asStatusFilter(value: string): StatusFilter {
  return (STATUS_FILTER_VALUES as readonly string[]).includes(value) ? (value as StatusFilter) : 'all';
}
