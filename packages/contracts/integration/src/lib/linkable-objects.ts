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
 *
 * Tạo nhanh (tuỳ chọn, thêm sau, module không khai báo thì không đổi gì): loại có `create: true` cho phép bên gọi tạo hồ
 * sơ mới ngay tại chỗ. Module gốc mô tả form và tự kiểm dữ liệu, quyền như form của chính nó; bên gọi chỉ vẽ form và gắn
 * kết quả:
 *   GET  /v1/linkable/create-form?kind=             → LinkableCreateForm
 *   POST /v1/linkable/create?kind=                  ← LinkableCreateRequest → LinkableObject (201)
 * Lỗi trả `{ statusCode, code, message }`; cần người dùng xác nhận (ví dụ trùng mã số thuế) thì 409
 * `LINKABLE_CONFIRM_REQUIRED` kèm `warnings`, bên gọi gửi lại với `confirm: true`. POST đi bằng phiên của người dùng
 * (Bearer cùng `x-csrf-token` và cookie `ep_csrf` của chính họ), không bao giờ bằng service token.
 *
 * Phần thêm của tạo nhanh (tuỳ chọn, module không khai báo thì không đổi gì):
 *  - Lọc ô tham chiếu (`LinkableFormField.filters`): khi tìm lựa chọn, bên gọi gửi thêm `<param>=<giá trị>` vào
 *    `search` của module (`GET /v1/linkable/search?kind=&q=&limit=&<param>=...`). Tên tham số do chính module khai
 *    trong form; `search` của module chỉ đọc tham số nó biết, bỏ qua mọi tham số lạ (không có thì tìm như cũ).
 *  - Xem trước theo ô (`LinkableFormField.preview`): khi ô có giá trị, bên gọi hỏi
 *      GET /v1/linkable/create-preview?kind=&field=&value=   → LinkableCreatePreview
 *    và vẽ bảng chỉ đọc dưới ô. Lỗi nghiệp vụ (ví dụ hồ sơ không dùng được) trả như `create`, bên gọi hiện câu chữ và
 *    bỏ giá trị ô. Bản xem trước có thể kèm `fill` để điền các ô khác của form đang trống.
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
  /**
   * Người đang hỏi tạo nhanh được hồ sơ loại này (`create-form`, `create`). Vắng là không. Chỉ để ẩn hiện nút: module
   * gốc vẫn kiểm quyền lại khi tạo.
   */
  readonly create?: boolean;
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

/* ------------------------------------------------------------------ Tạo nhanh */

/**
 * Kiểu ô của form tạo nhanh. Bên gọi vẽ chung một kiểu cho mọi module:
 *  - `text`, `textarea`: chuỗi; `date`: chuỗi `YYYY-MM-DD`;
 *  - `money`: số VND (ô nhập có dấu chấm ngăn nghìn); `number`: số;
 *  - `select`: một giá trị trong `options` (danh sách cố định do module gửi kèm form);
 *  - `reference`: id một hồ sơ loại `reference` của CHÍNH module này, bên gọi tìm qua `search` của module đó.
 */
export type LinkableFormFieldType = 'text' | 'textarea' | 'date' | 'money' | 'number' | 'select' | 'reference';

export const LINKABLE_FORM_FIELD_TYPES: readonly LinkableFormFieldType[] = [
  'text',
  'textarea',
  'date',
  'money',
  'number',
  'select',
  'reference',
];

export interface LinkableFormOption {
  readonly value: string;
  readonly label: string;
  /** Dòng phụ, ví dụ mã. */
  readonly hint?: string;
}

/**
 * Một tham số lọc của ô `reference`: gửi `param=<giá trị ô fromField>` (ô đó trống thì không gửi), hoặc
 * `param=<value>` cố định. Có đúng một trong hai `fromField`, `value`.
 */
export interface LinkableReferenceFilter {
  /** Tên tham số của `search`; chữ, số, `_`, không trùng tham số chung (`kind`, `q`, `limit`, `ids`). */
  readonly param: string;
  /** Khoá một ô khác của cùng form. */
  readonly fromField?: string;
  readonly value?: string;
}

export interface LinkableFormField {
  /** Khoá gửi lại trong `values`; chỉ chữ, số, `_`. */
  readonly key: string;
  readonly label: string;
  readonly type: LinkableFormFieldType;
  /** Bên gọi chặn gửi khi còn trống; module gốc vẫn kiểm lại. */
  readonly required?: boolean;
  /** Dòng gợi ý dưới ô. */
  readonly hint?: string;
  readonly placeholder?: string;
  /** `text`, `textarea`. */
  readonly maxLength?: number;
  /** `number`, `money`. */
  readonly min?: number;
  readonly max?: number;
  /** `select`. */
  readonly options?: readonly LinkableFormOption[];
  /** `reference`: khoá loại cùng module, ví dụ `crm.customer`. */
  readonly reference?: LinkableKindKey;
  /**
   * `reference`: tham số lọc gửi thêm khi tìm lựa chọn, ví dụ báo giá chỉ của khách đang chọn. Khi giá trị nguồn
   * (`fromField`) đổi, bên gọi tìm lại; giá trị đang chọn của ô này được bỏ vì có thể không còn hợp.
   */
  readonly filters?: readonly LinkableReferenceFilter[];
  /**
   * Bắt buộc trừ khi ô có khoá này đã có giá trị (ví dụ khách hàng bắt buộc trừ khi đã chọn báo giá). Chỉ dùng khi
   * không có `required`.
   */
  readonly requiredUnless?: string;
  /** `reference`, `select`: có giá trị thì bên gọi hỏi `create-preview` và vẽ bảng xem trước dưới ô. */
  readonly preview?: boolean;
  /** Giá trị ban đầu: số cho `money`, `number`; chuỗi cho các kiểu còn lại. */
  readonly defaultValue?: string | number;
  /** Nhãn của giá trị ban đầu (ô `reference`, `select`) để hiện đúng trước khi tìm. */
  readonly defaultLabel?: string;
  /** Ô dài chiếm cả hàng. */
  readonly wide?: boolean;
}

export interface LinkableCreateForm {
  readonly kind: LinkableKindKey;
  /** Tiêu đề hộp thoại, ví dụ "Tạo hợp đồng bán". */
  readonly title: string;
  readonly subtitle?: string;
  readonly submitLabel?: string;
  readonly fields: readonly LinkableFormField[];
}

/** Giá trị một ô khi gửi: chuỗi (đã cắt khoảng trắng), số, hoặc `null` khi trống. */
export type LinkableFormValue = string | number | null;
export type LinkableFormValues = Readonly<Record<string, LinkableFormValue>>;

export interface LinkableCreateRequest {
  readonly values: LinkableFormValues;
  /** Người dùng đã đọc cảnh báo của lần gửi trước (`LINKABLE_CONFIRM_REQUIRED`) và vẫn muốn tạo. */
  readonly confirm?: boolean;
}

/** Mã lỗi 409: cần người dùng xác nhận; thân lỗi có `warnings: string[]` (mỗi dòng một điều cần xem). */
export const LINKABLE_CONFIRM_REQUIRED = 'LINKABLE_CONFIRM_REQUIRED';

/** Kiểu cột của bảng xem trước: `money` số VND, `number` số, `text` chuỗi (module tự định dạng). */
export type LinkablePreviewColumnType = 'text' | 'number' | 'money';

export interface LinkablePreviewColumn {
  readonly key: string;
  readonly label: string;
  readonly type: LinkablePreviewColumnType;
}

export type LinkablePreviewCell = string | number | null;

/** Giá trị điền vào một ô khác của form (chỉ khi ô đó đang trống); `label` cho ô `reference`, `select`. */
export interface LinkableFormFill {
  readonly value: string | number;
  readonly label?: string;
}

/** Bản xem trước chỉ đọc cho một giá trị của ô có `preview`, ví dụ dòng hàng hợp đồng sẽ nhận từ báo giá. */
export interface LinkableCreatePreview {
  readonly field: string;
  readonly value: string;
  /** Tiêu đề bảng, ví dụ "Dòng hàng từ báo giá BG-001". */
  readonly title?: string;
  /** Một đoạn giải thích dưới tiêu đề (module tự định dạng số trong câu). */
  readonly note?: string;
  readonly columns: readonly LinkablePreviewColumn[];
  readonly rows: readonly Readonly<Record<string, LinkablePreviewCell>>[];
  /** Theo khoá ô của form; bên gọi chỉ điền ô có trong form và đang trống. */
  readonly fill?: Readonly<Record<string, LinkableFormFill>>;
}

export const LINKABLE_FORM_MAX_FIELDS = 40;
export const LINKABLE_FORM_MAX_OPTIONS = 1000;
export const LINKABLE_FORM_VALUE_MAX_LENGTH = 4000;
export const LINKABLE_FILTER_MAX = 6;
export const LINKABLE_FILTER_VALUE_MAX_LENGTH = 160;
export const LINKABLE_PREVIEW_MAX_COLUMNS = 12;
export const LINKABLE_PREVIEW_MAX_ROWS = 300;
/** Tham số chung của các route `linkable`; tham số lọc không được trùng. */
export const LINKABLE_RESERVED_PARAMS: readonly string[] = ['kind', 'q', 'limit', 'ids', 'field', 'value'];

const FORM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORM_KIND_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const PREVIEW_COLUMN_TYPES: readonly LinkablePreviewColumnType[] = ['text', 'number', 'money'];

/** Khoá ô hoặc tên tham số hợp lệ (chữ, số, `_`, bắt đầu bằng chữ). */
export function isLinkableFormKey(value: unknown): value is string {
  return typeof value === 'string' && FORM_KEY_PATTERN.test(value);
}

function formRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function formNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeFormOption(entry: unknown): LinkableFormOption | undefined {
  const item = formRecord(entry);
  const value = formText(item?.['value'], 160);
  const label = formText(item?.['label'], 255);
  if (!item || !value || !label) return undefined;
  return { value, label, hint: formText(item['hint'], 255) };
}

function sanitizeFormField(entry: unknown, moduleKey: string): LinkableFormField | undefined {
  const item = formRecord(entry);
  const key = formText(item?.['key'], 64);
  const label = formText(item?.['label'], 100);
  const type = item?.['type'] as LinkableFormFieldType;
  if (!item || !key || !label || !FORM_KEY_PATTERN.test(key) || !LINKABLE_FORM_FIELD_TYPES.includes(type)) {
    return undefined;
  }
  const numeric = type === 'money' || type === 'number';
  const rawDefault = item['defaultValue'];
  const defaultValue = numeric
    ? formNumber(rawDefault)
    : typeof rawDefault === 'string'
      ? rawDefault.slice(0, LINKABLE_FORM_VALUE_MAX_LENGTH)
      : undefined;
  const maxLength = formNumber(item['maxLength']);
  const field: LinkableFormField = {
    key,
    label,
    type,
    required: item['required'] === true ? true : undefined,
    hint: formText(item['hint'], 300),
    placeholder: formText(item['placeholder'], 200),
    maxLength:
      (type === 'text' || type === 'textarea') && maxLength !== undefined && maxLength >= 1
        ? Math.min(Math.floor(maxLength), LINKABLE_FORM_VALUE_MAX_LENGTH)
        : undefined,
    min: numeric ? formNumber(item['min']) : undefined,
    max: numeric ? formNumber(item['max']) : undefined,
    defaultValue: defaultValue === '' ? undefined : defaultValue,
    defaultLabel: formText(item['defaultLabel'], 255),
    wide: item['wide'] === true ? true : undefined,
    // Ô khác có thật trong form hay không thì kiểm sau khi đọc hết ô (`sanitizeLinkableCreateForm`).
    requiredUnless:
      item['required'] !== true && isLinkableFormKey(item['requiredUnless']) && item['requiredUnless'] !== key
        ? item['requiredUnless']
        : undefined,
    preview: (type === 'reference' || type === 'select') && item['preview'] === true ? true : undefined,
  };
  if (type === 'select') {
    const options = (Array.isArray(item['options']) ? item['options'] : [])
      .slice(0, LINKABLE_FORM_MAX_OPTIONS)
      .flatMap((option) => {
        const sanitized = sanitizeFormOption(option);
        return sanitized ? [sanitized] : [];
      });
    return { ...field, options };
  }
  if (type === 'reference') {
    // Chỉ tìm trong chính module đã gửi form: form của module này không được trỏ người dùng sang dữ liệu module khác.
    const reference = formText(item['reference'], 64);
    if (!reference || !FORM_KIND_PATTERN.test(reference) || linkableModuleOf(reference) !== moduleKey) return undefined;
    const filters = sanitizeReferenceFilters(item['filters'], key);
    return filters.length > 0 ? { ...field, reference, filters } : { ...field, reference };
  }
  return field;
}

/** Bộ lọc của ô `reference`: bỏ dòng sai hình dạng, tham số chung, tham số trùng, trỏ vào chính ô này. */
function sanitizeReferenceFilters(raw: unknown, ownKey: string): LinkableReferenceFilter[] {
  const filters: LinkableReferenceFilter[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (filters.length >= LINKABLE_FILTER_MAX) break;
    const item = formRecord(entry);
    const param = item?.['param'];
    if (!item || !isLinkableFormKey(param) || LINKABLE_RESERVED_PARAMS.includes(param) || seen.has(param)) continue;
    const fromField = item['fromField'];
    const value = formText(item['value'], LINKABLE_FILTER_VALUE_MAX_LENGTH);
    if (fromField !== undefined) {
      if (!isLinkableFormKey(fromField) || fromField === ownKey || value !== undefined) continue;
      filters.push({ param, fromField });
    } else if (value !== undefined) {
      filters.push({ param, value });
    } else continue;
    seen.add(param);
  }
  return filters;
}

/** Bỏ `requiredUnless`, `filters.fromField` trỏ tới ô không có trong form. */
function withKnownFieldLinks(field: LinkableFormField, keys: ReadonlySet<string>): LinkableFormField {
  let next = field;
  if (next.requiredUnless && !keys.has(next.requiredUnless)) next = { ...next, requiredUnless: undefined };
  if (next.filters) {
    const filters = next.filters.filter((filter) => !filter.fromField || keys.has(filter.fromField));
    if (filters.length !== next.filters.length) next = { ...next, filters: filters.length > 0 ? filters : undefined };
  }
  return next;
}

/**
 * Đọc form tạo nhanh nhận từ module khác: bỏ ô sai hình dạng, giữ thứ tự, bỏ khoá trùng (giữ ô đầu), ô `reference` chỉ
 * được trỏ tới loại cùng module với `kind`. Không còn ô nào hoặc thiếu tiêu đề thì trả `undefined`.
 */
export function sanitizeLinkableCreateForm(raw: unknown, kind: LinkableKindKey): LinkableCreateForm | undefined {
  const item = formRecord(raw);
  const title = formText(item?.['title'], 150);
  if (!item || !title || item['kind'] !== kind) return undefined;
  const moduleKey = linkableModuleOf(kind);
  const seen = new Set<string>();
  const fields: LinkableFormField[] = [];
  for (const entry of Array.isArray(item['fields']) ? item['fields'] : []) {
    if (fields.length >= LINKABLE_FORM_MAX_FIELDS) break;
    const field = sanitizeFormField(entry, moduleKey);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    fields.push(field);
  }
  if (fields.length === 0) return undefined;
  return {
    kind,
    title,
    subtitle: formText(item['subtitle'], 300),
    submitLabel: formText(item['submitLabel'], 60),
    fields: fields.map((field) => withKnownFieldLinks(field, seen)),
  };
}

/**
 * Đọc tham số lọc tìm kiếm (ô `reference` có `filters`) từ bên gọi, trước khi chuyển cho module gốc: chỉ tên tham số
 * hợp lệ, không trùng tham số chung, giá trị chuỗi (số, `true`/`false` đổi thành chuỗi) đã cắt, bỏ rỗng; tối đa
 * `LINKABLE_FILTER_MAX`. Module gốc vẫn chỉ đọc tham số nó biết.
 */
export function sanitizeLinkableSearchFilters(raw: unknown): Record<string, string> {
  const source = formRecord(raw) ?? {};
  const filters: Record<string, string> = {};
  let count = 0;
  for (const [param, entry] of Object.entries(source)) {
    if (count >= LINKABLE_FILTER_MAX) break;
    if (!isLinkableFormKey(param) || LINKABLE_RESERVED_PARAMS.includes(param)) continue;
    const value =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))
          ? String(entry)
          : undefined;
    const trimmed = value?.trim().slice(0, LINKABLE_FILTER_VALUE_MAX_LENGTH);
    if (!trimmed) continue;
    filters[param] = trimmed;
    count += 1;
  }
  return filters;
}

function sanitizePreviewCell(value: unknown, type: LinkablePreviewColumnType): LinkablePreviewCell {
  if (value === null || value === undefined) return null;
  if (type === 'text') return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 500) : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Đọc bản xem trước nhận từ module khác: cột sai hình dạng, kiểu lạ, khoá trùng bị bỏ; ô theo kiểu cột (số sai thành
 * rỗng); cắt ở `LINKABLE_PREVIEW_MAX_COLUMNS` cột, `LINKABLE_PREVIEW_MAX_ROWS` dòng; `fill` chỉ khoá ô hợp lệ. `field`
 * và `value` là của lời hỏi, không lấy từ thân trả về. Không còn cột nào thì trả bảng rỗng (vẫn hiện `note`).
 */
export function sanitizeLinkableCreatePreview(raw: unknown, field: string, value: string): LinkableCreatePreview | undefined {
  const item = formRecord(raw);
  if (!item) return undefined;
  const columns: LinkablePreviewColumn[] = [];
  const keys = new Set<string>();
  for (const entry of Array.isArray(item['columns']) ? item['columns'] : []) {
    if (columns.length >= LINKABLE_PREVIEW_MAX_COLUMNS) break;
    const column = formRecord(entry);
    const key = column?.['key'];
    const label = formText(column?.['label'], 60);
    const type = column?.['type'] as LinkablePreviewColumnType;
    if (!column || !isLinkableFormKey(key) || keys.has(key) || !label || !PREVIEW_COLUMN_TYPES.includes(type)) continue;
    keys.add(key);
    columns.push({ key, label, type });
  }
  const rows = (Array.isArray(item['rows']) ? item['rows'] : [])
    .slice(0, LINKABLE_PREVIEW_MAX_ROWS)
    .flatMap((entry) => {
      const row = formRecord(entry);
      if (!row) return [];
      const cells: Record<string, LinkablePreviewCell> = {};
      for (const column of columns) cells[column.key] = sanitizePreviewCell(row[column.key], column.type);
      return [cells];
    });
  const fill: Record<string, LinkableFormFill> = {};
  for (const [key, entry] of Object.entries(formRecord(item['fill']) ?? {}).slice(0, LINKABLE_FORM_MAX_FIELDS)) {
    const target = formRecord(entry);
    const raw = target?.['value'];
    const fillValue =
      typeof raw === 'number' && Number.isFinite(raw)
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? raw.trim().slice(0, LINKABLE_FORM_VALUE_MAX_LENGTH)
          : undefined;
    if (!isLinkableFormKey(key) || key === field || fillValue === undefined) continue;
    fill[key] = { value: fillValue, label: formText(target?.['label'], 255) };
  }
  return {
    field,
    value,
    title: formText(item['title'], 200),
    note: formText(item['note'], 1000),
    columns,
    rows: columns.length > 0 ? rows : [],
    fill: Object.keys(fill).length > 0 ? fill : undefined,
  };
}

/**
 * Đọc thân `POST create`: chỉ nhận khoá hợp lệ với giá trị chuỗi, số hữu hạn hay `null`; chuỗi được cắt khoảng trắng,
 * rỗng thành `null`, dài quá thì cắt. Thân sai hình dạng coi như form trống (module gốc sẽ báo thiếu ô bắt buộc).
 */
export function parseLinkableCreateRequest(raw: unknown): LinkableCreateRequest {
  const body = formRecord(raw);
  const source = formRecord(body?.['values']) ?? {};
  const values: Record<string, LinkableFormValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(source)) {
    if (count >= LINKABLE_FORM_MAX_FIELDS * 2) break;
    if (!FORM_KEY_PATTERN.test(key)) continue;
    if (value === null) values[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
    else if (typeof value === 'string') {
      const trimmed = value.trim();
      values[key] = trimmed ? trimmed.slice(0, LINKABLE_FORM_VALUE_MAX_LENGTH) : null;
    } else continue;
    count += 1;
  }
  return body?.['confirm'] === true ? { values, confirm: true } : { values };
}
