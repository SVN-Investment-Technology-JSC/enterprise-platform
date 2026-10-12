import type { PoolClient } from 'pg';
import type { HrmRequestReasonView } from '@enterprise-platform/contracts-hrm';
import { requireUuid } from './hrm-validation.js';
import {
  normalizeDescription,
  resolveRequestReason,
  type RequestReasonKind,
  type ResolvedRequestReason,
} from './hrm-request-reason.js';

/**
 * Lý do + mô tả của đơn từ khi TẠO đơn và khi ĐỌC đơn.
 *  - Lý do: chọn từ danh mục (`reasonId`), lưu `reason_id` + bản chụp tên `reason_name`. Đơn nghỉ dùng loại nghỉ làm lý do.
 *  - Mô tả: văn bản tự do (`description`), lưu ở cột `reason` cũ của bảng đơn. Trường cũ `reason` trong payload vẫn được nhận
 *    như bí danh của `description` (bản nháp và ứng dụng cũ); gửi cả hai thì `description` thắng.
 */

type Queryable = Pick<PoolClient, 'query'>;

/** Mô tả từ payload tạo/sửa đơn: `description` thắng, thiếu thì dùng bí danh cũ `reason`; rỗng thành null. */
export function pickDescription(body: {
  description?: unknown;
  reason?: unknown;
}): string | null {
  return normalizeDescription(body.description ?? body.reason);
}

/**
 * Giá trị lưu vào cột `reason` (mô tả). Cột này NOT NULL từ migration 0001 và không đổi schema,
 * nên mô tả trống được lưu là chuỗi rỗng; khi đọc, chuỗi rỗng trả về là `description: null`.
 */
export function descriptionColumn(description: string | null): string {
  return description ?? '';
}

export interface ResolvedReasonInput {
  readonly reason: ResolvedRequestReason;
  /** Mô tả đã chuẩn hóa; null khi không nhập. */
  readonly description: string | null;
}

/**
 * Kiểm tra payload tạo đơn làm thêm giờ, công tác, giải trình công hoặc đổi ca:
 * lý do bắt buộc và phải là lý do đang sử dụng của đúng loại đơn; mô tả bắt buộc khi lý do yêu cầu.
 * Ném 400 (tiếng Việt) khi sai.
 */
export async function resolveReasonInput(
  db: Queryable,
  tenantId: string,
  kind: RequestReasonKind,
  body: { reasonId?: unknown; description?: unknown; reason?: unknown },
): Promise<ResolvedReasonInput> {
  const description = pickDescription(body);
  const reasonId =
    body.reasonId === undefined || body.reasonId === null || body.reasonId === ''
      ? undefined
      : requireUuid(body.reasonId, 'Lý do');
  const reason = await resolveRequestReason(
    db,
    tenantId,
    kind,
    reasonId,
    description,
  );
  return { reason, description };
}

/**
 * Mã của lý do đã chọn trên đơn, dùng làm `sub_type_code` khi chọn cách duyệt theo lý do.
 * undefined khi đơn không có lý do danh mục (đơn cũ) hoặc lý do không còn tồn tại.
 */
export async function requestReasonCode(
  db: Queryable,
  tenantId: string,
  reasonId: unknown,
): Promise<string | undefined> {
  if (typeof reasonId !== 'string' || !reasonId) return undefined;
  const row = (
    await db.query(
      `SELECT code FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND id=$2`,
      [tenantId, reasonId],
    )
  ).rows[0];
  return (row?.code as string | null | undefined) || undefined;
}

/** Lý do và mô tả của dòng đơn làm thêm giờ / công tác / giải trình công / đổi ca (đơn cũ: reasonName null). */
export function requestReasonView(
  row: Record<string, unknown>,
): HrmRequestReasonView {
  const stored = typeof row['reason'] === 'string' ? row['reason'] : '';
  return {
    reasonId: (row['reason_id'] as string | null | undefined) ?? null,
    reasonName: (row['reason_name'] as string | null | undefined) ?? null,
    description: stored.trim() ? stored : null,
    reason: stored,
  };
}

/**
 * Lý do và mô tả của dòng đơn nghỉ: lý do là loại nghỉ (`leave_type_id`), tên lấy từ `leave_type_name`
 * khi truy vấn có nối bảng loại nghỉ.
 */
export function leaveReasonView(
  row: Record<string, unknown>,
): HrmRequestReasonView {
  return {
    ...requestReasonView(row),
    reasonId: (row['leave_type_id'] as string | null | undefined) ?? null,
    reasonName: (row['leave_type_name'] as string | null | undefined) ?? null,
  };
}
