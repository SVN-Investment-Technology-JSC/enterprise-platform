import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Lý do của đơn từ là danh mục cấu hình (hrm_schema.request_reasons), KHÔNG phải ô nhập tự do, và tách khỏi "mô tả":
 *  - Lý do: chọn từ danh mục, có "có lương / không lương" (`paid`) và có thể bắt buộc mô tả (`requiresDescription`).
 *  - Mô tả: văn bản tự do bổ sung (cột `reason` cũ của bảng đơn, API gọi là `description`).
 * Đơn nghỉ dùng loại nghỉ (leave_types) làm lý do nên không đi qua danh mục này.
 */
export const REQUEST_REASON_KINDS = [
  'OVERTIME',
  'BUSINESS_TRIP',
  'ATTENDANCE_CORRECTION',
  'SHIFT_CHANGE',
] as const;
export type RequestReasonKind = (typeof REQUEST_REASON_KINDS)[number];

/** Loại đơn HRM (request_kind của binding duyệt) tương ứng với từng loại danh mục. */
export const REQUEST_REASON_KIND_TO_REQUEST_KIND: Readonly<
  Record<RequestReasonKind, 'ot' | 'business_trip' | 'correction' | 'shift_change'>
> = {
  OVERTIME: 'ot',
  BUSINESS_TRIP: 'business_trip',
  ATTENDANCE_CORRECTION: 'correction',
  SHIFT_CHANGE: 'shift_change',
};

export const REQUEST_REASON_KIND_LABELS: Readonly<Record<RequestReasonKind, string>> = {
  OVERTIME: 'Làm thêm giờ',
  BUSINESS_TRIP: 'Công tác',
  ATTENDANCE_CORRECTION: 'Giải trình công',
  SHIFT_CHANGE: 'Đổi ca',
};

export function isRequestReasonKind(value: unknown): value is RequestReasonKind {
  return (
    typeof value === 'string' &&
    (REQUEST_REASON_KINDS as readonly string[]).includes(value)
  );
}

export interface DefaultRequestReason {
  readonly kind: RequestReasonKind;
  readonly code: string;
  readonly name: string;
  /** Diễn giải cho người chọn lý do (không phải mô tả của đơn). */
  readonly description: string;
  readonly requiresDescription: boolean;
  readonly sortOrder: number;
}

/**
 * Lý do mặc định của tenant. Cùng nội dung với phần seed trong migration 0045-hrm-request-reasons.sql
 * (có test đối chiếu); POST /request-reasons/defaults dùng danh sách này cho tenant mới.
 * Tất cả mặc định là có lương; lý do "Khác" bắt buộc người làm đơn nhập mô tả.
 */
export const DEFAULT_REQUEST_REASONS: readonly DefaultRequestReason[] = [
  { kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc', description: 'Làm thêm để hoàn thành công việc được giao', requiresDescription: false, sortOrder: 10 },
  { kind: 'OVERTIME', code: 'OT_OTHER', name: 'Khác', description: 'Lý do khác, cần mô tả cụ thể', requiresDescription: true, sortOrder: 90 },
  { kind: 'BUSINESS_TRIP', code: 'TRIP_PLAN', name: 'Công tác theo kế hoạch', description: 'Công tác theo kế hoạch đã được giao', requiresDescription: false, sortOrder: 10 },
  { kind: 'BUSINESS_TRIP', code: 'TRIP_OTHER', name: 'Khác', description: 'Lý do khác, cần mô tả cụ thể', requiresDescription: true, sortOrder: 90 },
  { kind: 'ATTENDANCE_CORRECTION', code: 'COR_FORGOT', name: 'Quên chấm công', description: 'Quên chấm vào hoặc chấm ra', requiresDescription: false, sortOrder: 10 },
  { kind: 'ATTENDANCE_CORRECTION', code: 'COR_DEVICE', name: 'Lỗi thiết bị hoặc mạng', description: 'Không chấm được do lỗi thiết bị hoặc mạng', requiresDescription: false, sortOrder: 20 },
  { kind: 'ATTENDANCE_CORRECTION', code: 'COR_OTHER', name: 'Khác', description: 'Lý do khác, cần mô tả cụ thể', requiresDescription: true, sortOrder: 90 },
  { kind: 'SHIFT_CHANGE', code: 'SC_PERSONAL', name: 'Việc cá nhân', description: 'Đổi ca vì việc cá nhân', requiresDescription: false, sortOrder: 10 },
  { kind: 'SHIFT_CHANGE', code: 'SC_WORK', name: 'Theo yêu cầu công việc', description: 'Đổi ca theo yêu cầu công việc', requiresDescription: false, sortOrder: 20 },
  { kind: 'SHIFT_CHANGE', code: 'SC_OTHER', name: 'Khác', description: 'Lý do khác, cần mô tả cụ thể', requiresDescription: true, sortOrder: 90 },
];

/** Mã lý do hợp lệ: chữ in hoa, số, gạch dưới; bắt đầu bằng chữ cái; 2-50 ký tự (cột code là varchar(50)). */
export const REQUEST_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,49}$/;

/**
 * Sinh mã lý do từ tên: bỏ dấu tiếng Việt, in hoa, ký tự khác chữ và số thành gạch dưới.
 * Ví dụ "Lỗi thiết bị hoặc mạng" thành "LOI_THIET_BI_HOAC_MANG". Tên không còn ký tự hợp lệ thì dùng "REASON".
 * Mã trả về chưa bảo đảm duy nhất; xem `uniqueReasonCode`.
 */
export function reasonCodeFromName(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!plain) return 'REASON';
  // Mã phải bắt đầu bằng chữ cái; chừa chỗ cho hậu tố _N của `uniqueReasonCode` (tối đa 50 ký tự).
  const base = (/^[0-9]/.test(plain) ? `R_${plain}` : plain)
    .slice(0, 40)
    .replace(/_+$/g, '');
  return base.length >= 2 ? base : 'REASON';
}

/** Thêm hậu tố _2, _3... cho tới khi mã chưa nằm trong `taken` (so sánh không phân biệt hoa thường). */
export function uniqueReasonCode(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((code) => code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface ResolvedRequestReason {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly paid: boolean;
  readonly requiresDescription: boolean;
}

/**
 * Kiểm tra lý do (chọn từ danh mục) và mô tả của một đơn mới; trả về lý do đã chuẩn hóa để lưu reason_id + reason_name.
 * Ném 400 (tiếng Việt) khi thiếu lý do, lý do không thuộc loại đơn, đã ngừng dùng, hoặc lý do bắt buộc mô tả mà mô tả trống.
 */
export async function resolveRequestReason(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  kind: RequestReasonKind,
  reasonId: string | null | undefined,
  description?: string | null,
): Promise<ResolvedRequestReason> {
  const label = REQUEST_REASON_KIND_LABELS[kind];
  if (!reasonId || typeof reasonId !== 'string')
    throw new BadRequestException(`Chọn lý do cho đơn ${label.toLowerCase()}. Lý do là danh mục cấu hình, không nhập tự do.`);
  const row = (
    await db.query(
      `SELECT id, code, name, paid, requires_description, active
         FROM hrm_schema.request_reasons
        WHERE tenant_id = $1 AND id = $2 AND kind = $3 AND deleted_at IS NULL`,
      [tenantId, reasonId, kind],
    )
  ).rows[0];
  if (!row) throw new BadRequestException(`Lý do không có trong danh mục đơn ${label.toLowerCase()}.`);
  if (!row.active)
    throw new BadRequestException(`Lý do "${row.name}" đã ngừng sử dụng. Hãy chọn lý do khác.`);
  if (row.requires_description && !(typeof description === 'string' && description.trim()))
    throw new BadRequestException(`Lý do "${row.name}" cần nhập mô tả cụ thể.`);
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    paid: row.paid !== false,
    requiresDescription: row.requires_description === true,
  };
}

/** Mô tả tự do đã chuẩn hóa để lưu (cột `reason` cũ): rỗng thành null, cắt khoảng trắng, tối đa 2000 ký tự. */
export function normalizeDescription(description: unknown): string | null {
  if (description == null) return null;
  if (typeof description !== 'string') throw new BadRequestException('Mô tả phải là văn bản.');
  const text = description.trim();
  if (text.length > 2000) throw new BadRequestException('Mô tả tối đa 2000 ký tự.');
  return text || null;
}
