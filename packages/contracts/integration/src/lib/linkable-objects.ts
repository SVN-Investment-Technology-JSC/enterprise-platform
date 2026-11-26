/**
 * Hợp đồng "đối tượng liên kết được": cách một module công bố hồ sơ của mình để module khác (Workspace) gắn vào dự án hay
 * công việc, mà hai bên không import code hay đọc schema của nhau.
 *
 * Mỗi module cung cấp ba route GET dưới tiền tố API của chính nó (`/api/crm`, `/api/finance`...), luôn được gọi dưới danh
 * nghĩa người dùng (`Authorization: Bearer`), nên module gốc tự kiểm quyền như với mọi route khác của nó:
 *   GET /v1/linkable/kinds                          → LinkableKindList
 *   GET /v1/linkable/search?kind=&q=&limit=         → LinkableCandidateList
 *   GET /v1/linkable/resolve?kind=&ids=a,b,c        → LinkableObjectList (id không thấy hoặc không có quyền thì bị bỏ qua)
 *
 * Quy tắc cho `label`: chỉ gồm mã và tên ngắn dễ nhận ra, KHÔNG chứa số tiền hay dữ liệu nhạy cảm. Workspace lưu nhãn này
 * và mọi thành viên dự án đều thấy. Thông tin đầy đủ (`fields`) thì không được lưu: bên gọi đọc trực tiếp mỗi lần hiển thị,
 * nên module gốc quyết ai thấy gì.
 */

/** Khoá loại dạng `<module>.<loại>`, ví dụ `crm.contract`; phần trước dấu chấm là khoá module. */
export type LinkableKindKey = string;

export interface LinkableKind {
  readonly key: LinkableKindKey;
  /** Tên module, dùng làm nhóm trong ô chọn, ví dụ "Bán hàng". */
  readonly moduleLabel: string;
  /** Tên loại, ví dụ "Hợp đồng bán". */
  readonly label: string;
  /** Loại này gợi ý được thông tin để điền sẵn khi tạo dự án (`LinkableObject.prefill`). */
  readonly prefill: boolean;
}

export interface LinkableKindList {
  readonly kinds: readonly LinkableKind[];
}

/** Một dòng trong kết quả tìm kiếm của ô chọn: nhẹ, không có thông tin chi tiết. */
export interface LinkableCandidate {
  readonly kind: LinkableKindKey;
  readonly id: string;
  readonly code?: string;
  /** Mã và tên ngắn; xem quy tắc ở đầu file. */
  readonly label: string;
  /** Nhãn trạng thái đã dịch, ví dụ "Hiệu lực". */
  readonly status?: string;
  /** Một dòng phụ giúp phân biệt khi chọn, ví dụ tên khách hàng. Không chứa số tiền. */
  readonly hint?: string;
}

export interface LinkableCandidateList {
  readonly items: readonly LinkableCandidate[];
}

export type LinkableFieldType = 'text' | 'money' | 'date';

/** Một dòng "nhãn: giá trị" để hiển thị; bên gọi vẽ chung một kiểu cho mọi module. */
export interface LinkableField {
  readonly key: string;
  readonly label: string;
  /** `money`: số (VND); `date`: chuỗi `YYYY-MM-DD`; `text`: chuỗi. `null` khi trống. */
  readonly value: string | number | null;
  readonly type: LinkableFieldType;
}

/** Tham chiếu tới một hồ sơ khác (ví dụ báo giá mà hợp đồng đi ra từ đó). */
export interface LinkableRef {
  readonly kind: LinkableKindKey;
  readonly id: string;
  readonly code?: string;
  readonly label: string;
}

/**
 * Bộ từ khoá chung để điền sẵn form tạo dự án. Bên gọi chỉ hiểu đúng các khoá này; module không cần biết Workspace có
 * những ô nào. Ngày dạng `YYYY-MM-DD`, tiền là số VND.
 */
export interface LinkablePrefill {
  readonly title?: string;
  readonly description?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly contractValue?: number;
  /** Id khách hàng ở Bán hàng; Workspace tự gắn qua luồng liên kết khách Bán hàng sẵn có. */
  readonly crmCustomerId?: string;
}

/** Hồ sơ đầy đủ để hiển thị, trả từ `resolve`. */
export interface LinkableObject extends LinkableCandidate {
  /** Đường dẫn nội bộ mở hồ sơ, bắt đầu bằng `/modules/`; do module gốc trả, bên gọi không tự ghép. */
  readonly launchUrl: string;
  readonly fields: readonly LinkableField[];
  /** Hồ sơ phía trước trong chuỗi nghiệp vụ (hợp đồng → báo giá → cơ hội); bên gọi gợi ý gắn luôn. */
  readonly upstream: readonly LinkableRef[];
  readonly prefill?: LinkablePrefill;
}

export interface LinkableObjectList {
  readonly items: readonly LinkableObject[];
}

export const LINKABLE_SEARCH_DEFAULT_LIMIT = 20;
export const LINKABLE_SEARCH_MAX_LIMIT = 30;
export const LINKABLE_RESOLVE_MAX_IDS = 50;

/** Khoá module của một khoá loại: `crm.contract` → `crm`. */
export function linkableModuleOf(kind: LinkableKindKey): string {
  const dot = kind.indexOf('.');
  return dot < 0 ? kind : kind.slice(0, dot);
}

/** Đọc danh sách id từ tham số `ids=a,b,c`: bỏ rỗng, bỏ trùng, cắt ở `LINKABLE_RESOLVE_MAX_IDS`. */
export function parseLinkableIds(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  const ids = text
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 160);
  return [...new Set(ids)].slice(0, LINKABLE_RESOLVE_MAX_IDS);
}

/** Giới hạn số dòng tìm kiếm trong khoảng hợp lệ. */
export function clampLinkableLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return LINKABLE_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), LINKABLE_SEARCH_MAX_LIMIT);
}
