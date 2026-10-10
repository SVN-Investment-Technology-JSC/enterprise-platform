import type { ProcedureAttributeItem } from './ui/dynamic-attribute-form';

/**
 * FIX-E-05: thuộc tính đã ánh xạ chế độ OVERWRITE được hệ thống cấp giá trị nên ẩn khỏi
 * khối thuộc tính động; thuộc tính PREFILL vẫn hiển thị và được điền sẵn từ trường form.
 */
export function visibleDynamicAttributes(
  attributes: ProcedureAttributeItem[],
): ProcedureAttributeItem[] {
  return attributes.filter((attribute) => attribute.mapping?.mode !== 'OVERWRITE');
}

/** Giá trị hiện có trong form tạo đơn, theo khóa trường HRM (form.*). */
export type FormFieldSource = Partial<Record<string, string | boolean | undefined>>;

/** Số giờ giữa hai mốc HH:mm (qua đêm tính sang ngày sau); undefined nếu không hợp lệ. */
export function hoursBetween(start?: string, end?: string): number | undefined {
  const parse = (value?: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
  };
  const from = parse(start);
  const to = parse(end);
  if (from === undefined || to === undefined) return undefined;
  const minutes = to >= from ? to - from : to + 1440 - from;
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Giá trị điền sẵn cho thuộc tính PREFILL ánh xạ tới trường form (ngữ cảnh nhân viên/nghiệp vụ
 * do hệ thống điền khi gửi nếu người nộp bỏ trống).
 */
export function prefillAttributeValues(
  attributes: ProcedureAttributeItem[],
  source: FormFieldSource,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attribute of attributes) {
    const mapping = attribute.mapping;
    if (!mapping || mapping.mode !== 'PREFILL' || mapping.group !== 'form')
      continue;
    const raw = source[mapping.hrmField];
    if (raw === undefined || raw === '') continue;
    if (['number', 'money', 'percent'].includes(attribute.type)) {
      const value = Number(raw);
      if (Number.isFinite(value)) result[attribute.code] = value;
    } else if (attribute.type === 'boolean') {
      result[attribute.code] = raw === true || raw === 'true';
    } else {
      result[attribute.code] = String(raw);
    }
  }
  return result;
}

export type BindingLoadState =
  | { status: 'ready'; definitionName: string; attributes: ProcedureAttributeItem[] }
  | { status: 'direct' }
  | { status: 'subtype-required'; message: string }
  | { status: 'error'; code?: string; message: string };

/**
 * Mã loại con dùng để chọn binding, khớp với cách backend chọn khi gửi đơn: theo MÃ LÝ DO của đơn
 * (đơn nghỉ: mã loại nghỉ; làm thêm giờ, công tác, đổi ca, giải trình công: mã lý do trong danh mục).
 * Ứng lương và đính chính hồ sơ không có lý do nên không có loại con.
 */
export function requestSubTypeCode(
  kind: string,
  input: { leaveTypeCode?: string; reasonCode?: string },
): string | undefined {
  if (kind === 'leave') return input.leaveTypeCode || undefined;
  if (
    kind === 'ot' ||
    kind === 'business_trip' ||
    kind === 'shift_change' ||
    kind === 'correction'
  )
    return input.reasonCode || undefined;
  return undefined;
}

export function bindingUrl(kind: string, subTypeCode?: string): string {
  const query = new URLSearchParams({ kind });
  if (subTypeCode) query.set('subTypeCode', subTypeCode);
  return `/api/hrm/v1/procedure-definitions/binding?${query.toString()}`;
}

/** Đọc mã lỗi/thông điệp từ thân lỗi của API (phẳng hoặc lồng trong error). */
export function apiErrorInfo(body: unknown): { code?: string; message?: string } {
  const record = (body ?? {}) as {
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
  };
  return {
    code: record.code ?? record.error?.code,
    message: record.message ?? record.error?.message,
  };
}

export const PROCEDURE_UNAVAILABLE_MESSAGE =
  'Procedure Engine đang không khả dụng nên chưa tải được biểu mẫu và chưa thể gửi đơn theo quy trình. Vui lòng thử lại sau hoặc liên hệ quản trị viên.';

export function interpretBindingResponse(
  status: number,
  body: unknown,
): BindingLoadState {
  if (status >= 200 && status < 300) {
    const data = (body as { data?: Record<string, unknown> | null })?.data;
    if (!data) return { status: 'direct' };
    if (data.code === 'SUBTYPE_REQUIRED')
      return {
        status: 'subtype-required',
        message: String(data.message || 'Chọn loại đơn con để tải biểu mẫu'),
      };
    return {
      status: 'ready',
      definitionName: String(data.definitionName || ''),
      attributes: (data.attributes as ProcedureAttributeItem[]) || [],
    };
  }
  const { code, message } = apiErrorInfo(body);
  if (code === 'PROCEDURE_UNAVAILABLE')
    return { status: 'error', code, message: PROCEDURE_UNAVAILABLE_MESSAGE };
  return {
    status: 'error',
    code,
    message: message || `Không tải được biểu mẫu quy trình (mã ${status})`,
  };
}

/** Giữ lại giá trị của các thuộc tính còn tồn tại trong biểu mẫu hiện hành. */
export function pruneAttributeValues(
  values: Record<string, unknown>,
  attributes: ProcedureAttributeItem[],
): { values: Record<string, unknown>; dropped: string[] } {
  const codes = new Set(attributes.map((attribute) => attribute.code));
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [code, value] of Object.entries(values)) {
    if (codes.has(code)) kept[code] = value;
    else dropped.push(code);
  }
  return { values: kept, dropped };
}
