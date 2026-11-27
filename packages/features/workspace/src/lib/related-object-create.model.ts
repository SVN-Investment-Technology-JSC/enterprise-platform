import {
  RELATED_OBJECT_CONFIRM_REQUIRED,
  type RelatedObjectCreateForm,
  type RelatedObjectCreatePreview,
  type RelatedObjectFormField,
  type RelatedObjectPreview,
  type RelatedObjectPreviewColumn,
  type RelatedObjectRecordCreateRequest,
} from '@enterprise-platform/contracts-workspace';
import { formatVnd, parseVndInput, toVndInput } from './money';
import { relatedDisplayLabel, type PendingRelatedFields } from './related-objects.model';

/*
 * Logic thuần của hộp thoại "Tạo mới" hồ sơ ở module khác (tạo nhanh). Form do module gốc mô tả; ở đây chỉ giữ giá trị
 * đang nhập, kiểm ô bắt buộc cho đỡ một lượt gửi, và đổi giá trị thành thân request. Mọi quy tắc khác (định dạng, quyền,
 * trùng lặp) do module gốc kiểm khi tạo.
 */

/** Giá trị đang nhập của từng ô, luôn là chuỗi như trong ô nhập (tiền có dấu chấm ngăn nghìn). */
export type CreateDraftValues = Readonly<Record<string, string>>;

/** Nhãn hiển thị của ô tham chiếu đã chọn, để ô chọn hiện đúng khi hồ sơ đó không nằm trong kết quả tìm hiện tại. */
export type CreateDraftLabels = Readonly<Record<string, string>>;

/** Giá trị ban đầu theo `defaultValue` của từng ô. */
export function initialCreateDraft(form: RelatedObjectCreateForm): {
  readonly values: CreateDraftValues;
  readonly labels: CreateDraftLabels;
} {
  const values: Record<string, string> = {};
  const labels: Record<string, string> = {};
  for (const field of form.fields) {
    const raw = field.defaultValue;
    if (raw === undefined || raw === null) values[field.key] = '';
    else if (field.type === 'money') values[field.key] = typeof raw === 'number' ? toVndInput(raw) : '';
    else if (field.type === 'number') values[field.key] = typeof raw === 'number' ? String(raw) : '';
    else values[field.key] = String(raw);
    if (field.defaultLabel && values[field.key]) labels[field.key] = field.defaultLabel;
  }
  return { values, labels };
}

const CHOOSE_TYPES: ReadonlySet<RelatedObjectFormField['type']> = new Set(['select', 'reference', 'date']);

/** Đọc ô số: rỗng là `null`, đọc không được là `undefined`. */
function parseNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/** Ô đang bắt buộc: `required`, hoặc `requiredUnless` mà ô kia còn trống (ví dụ khách bắt buộc khi chưa chọn báo giá). */
export function isCreateFieldRequired(field: RelatedObjectFormField, values: CreateDraftValues): boolean {
  if (field.required) return true;
  return Boolean(field.requiredUnless) && !(values[field.requiredUnless ?? ''] ?? '').trim();
}

/** Tham số lọc của ô tham chiếu theo giá trị hiện tại của form; ô nguồn trống thì không gửi tham số đó. */
export function referenceFiltersOf(field: RelatedObjectFormField, values: CreateDraftValues): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const filter of field.filters ?? []) {
    const value = filter.fromField ? (values[filter.fromField] ?? '').trim() : (filter.value ?? '').trim();
    if (value) filters[filter.param] = value;
  }
  return filters;
}

/** Ô tham chiếu lọc theo ô `key`: khi `key` đổi giá trị, lựa chọn đang có của các ô này có thể không còn hợp. */
export function dependentReferenceKeys(form: RelatedObjectCreateForm, key: string): string[] {
  return form.fields
    .filter((field) => field.type === 'reference' && (field.filters ?? []).some((filter) => filter.fromField === key))
    .map((field) => field.key);
}

/**
 * Điền từ bản xem trước (`fill`): chỉ ô có trong form, không phải chính ô xem trước, và đang trống (không đè chữ người
 * dùng đã nhập). Tiền thành chuỗi có dấu chấm ngăn nghìn như trong ô nhập. Trả giá trị, nhãn mới và các ô đã điền.
 */
export function applyPreviewFill(
  form: RelatedObjectCreateForm,
  preview: Pick<RelatedObjectCreatePreview, 'field' | 'fill'>,
  values: CreateDraftValues,
  labels: CreateDraftLabels,
): { readonly values: CreateDraftValues; readonly labels: CreateDraftLabels; readonly filled: readonly string[] } {
  const nextValues: Record<string, string> = { ...values };
  const nextLabels: Record<string, string> = { ...labels };
  const filled: string[] = [];
  for (const field of form.fields) {
    const fill = preview.fill?.[field.key];
    if (!fill || field.key === preview.field || (values[field.key] ?? '').trim()) continue;
    const text =
      field.type === 'money'
        ? typeof fill.value === 'number'
          ? toVndInput(fill.value)
          : ''
        : String(fill.value);
    if (!text) continue;
    nextValues[field.key] = text;
    if (fill.label) nextLabels[field.key] = fill.label;
    filled.push(field.key);
  }
  return { values: nextValues, labels: nextLabels, filled };
}

/** Một ô của bảng xem trước theo kiểu cột: tiền VND, số kiểu Việt Nam, chữ giữ nguyên; trống là chuỗi rỗng. */
export function formatPreviewCell(value: string | number | null | undefined, type: RelatedObjectPreviewColumn['type']): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'text' || typeof value !== 'number') return String(value);
  return type === 'money' ? formatVnd(value) : value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

/**
 * Lỗi đầu tiên cần báo trước khi gửi: ô bắt buộc còn trống, ô số hay tiền đọc không được hoặc ngoài khoảng. Không có
 * lỗi thì `undefined`.
 */
export function createDraftError(form: RelatedObjectCreateForm, values: CreateDraftValues): string | undefined {
  for (const field of form.fields) {
    const text = (values[field.key] ?? '').trim();
    if (!text) {
      if (isCreateFieldRequired(field, values)) {
        return `Vui lòng ${CHOOSE_TYPES.has(field.type) ? 'chọn' : 'nhập'} ${field.label.toLocaleLowerCase('vi')}.`;
      }
      continue;
    }
    if (field.type !== 'money' && field.type !== 'number') continue;
    const value = field.type === 'money' ? parseVndInput(text) : parseNumber(text);
    if (value === undefined || value === null) return `${field.label}: không đọc được số.`;
    if (field.min !== undefined && value < field.min) return `${field.label} không được nhỏ hơn ${field.min}.`;
    if (field.max !== undefined && value > field.max) return `${field.label} không được lớn hơn ${field.max}.`;
  }
  return undefined;
}

/** Thân `POST /related-objects/create`: tiền và số thành số, ô trống thành `null`, chuỗi đã cắt khoảng trắng. */
export function createRequestOf(
  form: RelatedObjectCreateForm,
  values: CreateDraftValues,
  confirm: boolean,
): RelatedObjectRecordCreateRequest {
  const result: Record<string, string | number | null> = {};
  for (const field of form.fields) {
    const text = (values[field.key] ?? '').trim();
    if (field.type === 'money') result[field.key] = parseVndInput(text) ?? null;
    else if (field.type === 'number') result[field.key] = parseNumber(text) ?? null;
    else result[field.key] = text || null;
  }
  return confirm ? { values: result, confirm: true } : { values: result };
}

/** Cảnh báo cần người dùng xác nhận (vd trùng mã số thuế) trong lỗi trả về, nếu có. */
export function confirmationOf(cause: unknown): { readonly message: string; readonly warnings: readonly string[] } | undefined {
  const error = cause as { code?: unknown; message?: unknown; warnings?: unknown } | null;
  if (!error || error.code !== RELATED_OBJECT_CONFIRM_REQUIRED) return undefined;
  const warnings = Array.isArray(error.warnings)
    ? error.warnings.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : [];
  return { message: typeof error.message === 'string' ? error.message : 'Cần xác nhận trước khi tạo.', warnings };
}

/** Câu lỗi để hiện: câu của module gốc nếu có, không thì câu mặc định. */
export function createErrorMessage(cause: unknown, fallback = 'Không tạo được hồ sơ.'): string {
  const message = (cause as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** Hồ sơ vừa tạo thành phần cần điền vào một dòng chờ gắn (dòng đi tiếp đúng vòng đời như hồ sơ chọn sẵn). */
export function pendingFromCreated(created: Pick<RelatedObjectPreview, 'id' | 'code' | 'label' | 'kindLabel'>): Pick<
  PendingRelatedFields,
  'objectId' | 'label'
> {
  return { objectId: created.id, label: relatedDisplayLabel(created.code, created.label) };
}
