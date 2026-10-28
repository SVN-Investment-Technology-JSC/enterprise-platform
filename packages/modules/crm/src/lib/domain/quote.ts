import {
  QUOTE_REVISABLE_STATUSES,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_TRANSITIONS,
  QUOTE_STATUSES,
  type QuoteStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError } from './crm.error.js';

/**
 * Máy trạng thái phiên bản báo giá (mục 5.2 kế hoạch):
 *
 * - Nháp → Chờ duyệt (vượt ngưỡng) hoặc Đã duyệt (không vượt);
 * - Chờ duyệt → Đã duyệt hoặc Từ chối duyệt (Quy trình hay người duyệt);
 * - Đã duyệt → Đã gửi khách → Khách chấp nhận hoặc Khách từ chối;
 * - Đã duyệt, Đã gửi khách → Hết hạn (job khi quá hạn hiệu lực);
 * - Đã duyệt, Đã gửi khách, Từ chối duyệt → Đã thay thế (sửa, sinh phiên bản mới);
 * - Khách chấp nhận, Khách từ chối, Hết hạn, Đã thay thế là trạng thái cuối.
 *
 * Chuyển không có trong bảng trả 409 với thông báo tiếng Việt.
 */
export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === 'string' && (QUOTE_STATUSES as readonly string[]).includes(value);
}

export function canQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Trạng thái cuối: không chuyển đi đâu, không sửa. */
export function isQuoteClosed(status: QuoteStatus): boolean {
  return QUOTE_STATUS_TRANSITIONS[status].length === 0;
}

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (canQuoteTransition(from, to)) return;
  if (from === 'EXPIRED') throw new CrmConflictError('QUOTE_EXPIRED', 'Báo giá đã hết hạn.');
  if (from === 'PENDING' && (to === 'SENT' || to === 'ACCEPTED')) {
    throw new CrmConflictError('QUOTE_NOT_APPROVED', 'Báo giá đang chờ duyệt, chưa gửi khách hay chốt được.');
  }
  if (from === 'DRAFT' && (to === 'SENT' || to === 'ACCEPTED')) {
    throw new CrmConflictError('QUOTE_NOT_APPROVED', 'Báo giá chưa được duyệt, chưa gửi khách hay chốt được.');
  }
  throw new CrmConflictError(
    'INVALID_QUOTE_TRANSITION',
    `Không thể chuyển báo giá từ "${QUOTE_STATUS_LABELS[from]}" sang "${QUOTE_STATUS_LABELS[to]}".`,
  );
}

/**
 * Lần chuyển do hệ thống làm, ngoài bảng chuyển của người dùng:
 *
 * - `OPPORTUNITY_LOST` (T3-21): cơ hội chuyển Thua thì mọi báo giá chưa kết
 *   thúc (Nháp, Chờ duyệt, Đã duyệt, Đã gửi khách, Từ chối duyệt) sang Khách từ
 *   chối với lý do "Cơ hội đã thua";
 * - `PROCEDURE_REVERSED` (T3-19): Quy trình thu hồi phiên đã duyệt thì báo giá
 *   Đã duyệt, Đã gửi khách (chưa chuyển hợp đồng) về Từ chối duyệt.
 */
export type QuoteSystemTransition = 'OPPORTUNITY_LOST' | 'PROCEDURE_REVERSED';

const QUOTE_SYSTEM_TRANSITIONS: Readonly<Record<QuoteSystemTransition, Partial<Record<QuoteStatus, readonly QuoteStatus[]>>>> = {
  OPPORTUNITY_LOST: {
    DRAFT: ['DECLINED'],
    PENDING: ['DECLINED'],
    APPROVED: ['DECLINED'],
    SENT: ['DECLINED'],
    REJECTED: ['DECLINED'],
  },
  PROCEDURE_REVERSED: {
    APPROVED: ['REJECTED'],
    SENT: ['REJECTED'],
  },
};

/** Lý do ghi vào báo giá khi cơ hội chuyển Thua. */
export const QUOTE_OPPORTUNITY_LOST_REASON = 'Cơ hội đã thua';
/** Lý do ghi vào báo giá khi Quy trình thu hồi kết quả duyệt. */
export const QUOTE_PROCEDURE_REVERSED_REASON = 'Quy trình đã thu hồi';

export function canQuoteSystemTransition(kind: QuoteSystemTransition, from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_SYSTEM_TRANSITIONS[kind][from]?.includes(to) ?? false;
}

/** Quá hạn hiệu lực: ngày hiệu lực cuối nhỏ hơn hôm nay (cả hai `YYYY-MM-DD` giờ Việt Nam). */
export function isPastValidity(validUntil: string | null, today: string): boolean {
  return !!validUntil && validUntil < today;
}

/**
 * Kiểm một lần chuyển do người dùng bấm (gửi khách, khách chấp nhận, khách từ
 * chối) với hạn hiệu lực: báo giá đã quá hạn mà job chưa kịp chạy vẫn coi là
 * hết hạn.
 */
export function assertCustomerTransition(
  from: QuoteStatus,
  to: QuoteStatus,
  validUntil: string | null,
  today: string,
): void {
  assertQuoteTransition(from, to);
  if (isPastValidity(validUntil, today)) throw new CrmConflictError('QUOTE_EXPIRED', 'Báo giá đã hết hạn.');
}

export type QuoteEditPlan = 'IN_PLACE' | 'NEW_VERSION';

/**
 * Sửa một phiên bản (dòng, phí vận chuyển, hạn hiệu lực) làm gì:
 *
 * - không phải phiên bản hiện tại: 409 "Phiên bản cũ chỉ đọc";
 * - Nháp: sửa ngay trên phiên bản;
 * - Đã duyệt, Đã gửi khách, Từ chối duyệt: sinh phiên bản mới ở Nháp, phiên bản
 *   đang có chuyển Đã thay thế;
 * - Chờ duyệt: 409 (đợi kết quả duyệt);
 * - trạng thái cuối: 409.
 */
export function planQuoteEdit(input: {
  readonly currentVersion: number;
  readonly versionNo: number;
  readonly status: QuoteStatus;
}): QuoteEditPlan {
  if (input.versionNo !== input.currentVersion) {
    throw new CrmConflictError('QUOTE_VERSION_READ_ONLY', 'Phiên bản cũ chỉ đọc.');
  }
  if (input.status === 'DRAFT') return 'IN_PLACE';
  if (QUOTE_REVISABLE_STATUSES.includes(input.status)) return 'NEW_VERSION';
  if (input.status === 'PENDING') {
    throw new CrmConflictError('QUOTE_PENDING', 'Báo giá đang chờ duyệt, chưa sửa được.');
  }
  if (input.status === 'EXPIRED') throw new CrmConflictError('QUOTE_EXPIRED', 'Báo giá đã hết hạn.');
  throw new CrmConflictError(
    'QUOTE_CLOSED',
    `Báo giá ở trạng thái "${QUOTE_STATUS_LABELS[input.status]}", không sửa được.`,
  );
}

/** Mã báo giá dạng `BG<yy><5 chữ số>` từ năm (giờ Việt Nam) và số thứ tự. */
export function formatQuoteCode(year: number, sequence: number): string {
  return `BG${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}
