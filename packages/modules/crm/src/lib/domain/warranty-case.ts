import {
  WARRANTY_STATUS_LABELS,
  WARRANTY_STATUS_TRANSITIONS,
  WARRANTY_STATUSES,
  type WarrantyDisposition,
  type WarrantyDocumentKind,
  type WarrantyDocumentStatus,
  type WarrantyInspectionResult,
  type WarrantyRemedy,
  type WarrantyStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';

/**
 * Máy trạng thái yêu cầu bảo hành (mục 5.5 kế hoạch, TC-SM-10):
 *
 * - Tiếp nhận → Chờ nhận hàng (gửi nhập trả về kho cách ly), Từ chối (không đủ
 *   điều kiện, có lý do);
 * - Chờ nhận hàng → Đang kiểm định khi Kho phát `inventory.stock.returned`;
 * - Đang kiểm định → Đang xử lý khi mọi dòng có kết quả Đạt hoặc Lỗi;
 * - Đang xử lý → Đã xử lý khi mọi dòng có hướng xử lý và chứng từ đã sinh;
 * - Đã xử lý → Đã đóng khi mọi chứng từ đã ghi sổ; Từ chối → Đã đóng.
 */
export function isWarrantyStatus(value: unknown): value is WarrantyStatus {
  return typeof value === 'string' && (WARRANTY_STATUSES as readonly string[]).includes(value);
}

export function canWarrantyTransition(from: WarrantyStatus, to: WarrantyStatus): boolean {
  return WARRANTY_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertWarrantyTransition(from: WarrantyStatus, to: WarrantyStatus): void {
  if (canWarrantyTransition(from, to)) return;
  throw new CrmConflictError(
    'INVALID_WARRANTY_TRANSITION',
    `Không thể chuyển yêu cầu bảo hành từ "${WARRANTY_STATUS_LABELS[from]}" sang "${WARRANTY_STATUS_LABELS[to]}".`,
  );
}

/** Mã yêu cầu dạng `BH<yy><5 chữ số>`. */
export function formatWarrantyCode(year: number, sequence: number): string {
  return `BH${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

/** Khoá chống lặp của lệnh nhập trả về kho cách ly. */
export function receiveIdempotencyKey(caseId: string): string {
  return `crm-warranty:${caseId}:receive`;
}

/** Khoá chống lặp của một chứng từ sinh cho một dòng. */
export function lineDocumentKey(caseId: string, lineId: string, kind: WarrantyDocumentKind, seq = 1): string {
  return `crm-warranty:${caseId}:${lineId}:${kind.toLowerCase()}${seq > 1 ? `:${seq}` : ''}`;
}

/** Hướng xử lý hợp lệ với kết quả kiểm định: Đạt thì nhập lại; Lỗi thì chuyển kho lỗi hoặc loại bỏ. */
export const DISPOSITIONS_BY_RESULT: Readonly<Record<WarrantyInspectionResult, readonly WarrantyDisposition[]>> = {
  PASSED: ['RESTOCK'],
  DEFECTIVE: ['MOVE_TO_DEFECT', 'SCRAP'],
};

export interface ResolutionInput {
  readonly result: WarrantyInspectionResult | null;
  readonly disposition: WarrantyDisposition;
  readonly remedy: WarrantyRemedy;
  /** Dòng có dòng đơn (có giá) để tính số tiền hoàn, giảm trừ. */
  readonly hasOrderLine: boolean;
}

/**
 * Kiểm hướng xử lý của một dòng (T6-05, T6-06): phải kiểm định xong; hướng xử
 * lý hàng khớp kết quả; hoàn tiền, giảm trừ công nợ cần dòng đơn để biết giá.
 */
export function assertResolution(input: ResolutionInput): void {
  if (!input.result) {
    throw new CrmConflictError('LINE_NOT_INSPECTED', 'Dòng chưa có kết quả kiểm định.');
  }
  if (!DISPOSITIONS_BY_RESULT[input.result].includes(input.disposition)) {
    throw new CrmValidationError(
      'INVALID_DISPOSITION',
      input.result === 'PASSED'
        ? 'Hàng kiểm định Đạt chỉ được nhập lại kho.'
        : 'Hàng kiểm định Lỗi phải chuyển kho lỗi hoặc loại bỏ.',
    );
  }
  if ((input.remedy === 'REFUND' || input.remedy === 'CREDIT') && !input.hasOrderLine) {
    throw new CrmValidationError('ORDER_LINE_REQUIRED', 'Hoàn tiền, giảm trừ công nợ cần dòng đơn bán để tính giá trị.');
  }
}

/**
 * Chứng từ cần sinh cho một dòng theo hướng xử lý, theo thứ tự gửi:
 * nhập lại: đổi chất lượng về Đạt; chuyển kho lỗi: đổi chất lượng sang Lỗi rồi
 * điều chuyển sang kho lỗi; loại bỏ: đổi sang Lỗi rồi lập xuất khác (chờ duyệt);
 * đổi hàng: xuất bảo hành; hoàn tiền, giảm trừ: chứng từ công nợ.
 */
export function documentsForResolution(disposition: WarrantyDisposition, remedy: WarrantyRemedy): WarrantyDocumentKind[] {
  const kinds: WarrantyDocumentKind[] = ['QUALITY'];
  // Nhập lại (T6-11) và chuyển kho lỗi đều điều chuyển ra khỏi kho cách ly.
  if (disposition === 'RESTOCK' || disposition === 'MOVE_TO_DEFECT') kinds.push('TRANSFER');
  if (disposition === 'SCRAP') kinds.push('SCRAP');
  if (remedy === 'REPLACE') kinds.push('REPLACEMENT');
  if (remedy === 'CREDIT') kinds.push('CREDIT');
  if (remedy === 'REFUND') kinds.push('REFUND');
  return kinds;
}

/** Chứng từ đã sinh (không còn phải gửi lại): mọi trạng thái trừ "chưa gửi được". */
export function isDocumentIssued(status: WarrantyDocumentStatus): boolean {
  return status !== 'PENDING';
}

/** Chứng từ phải gửi lại khi bấm "Gửi lại chứng từ" (lỗi tạm, sổ công nợ chưa sẵn sàng). */
export function needsResend(status: WarrantyDocumentStatus): boolean {
  return status === 'PENDING' || status === 'PENDING_RECEIVABLE';
}

/** Dòng đã xử lý xong: có hướng xử lý và mọi chứng từ cần có đều đã sinh. */
export function isLineResolved(
  line: { readonly disposition: WarrantyDisposition | null; readonly remedy: WarrantyRemedy | null },
  documents: readonly { readonly kind: WarrantyDocumentKind; readonly status: WarrantyDocumentStatus }[],
): boolean {
  if (!line.disposition || !line.remedy) return false;
  return documentsForResolution(line.disposition, line.remedy).every((kind) =>
    documents.some((document) => document.kind === kind && isDocumentIssued(document.status)),
  );
}

/**
 * Đóng yêu cầu (WAR-07, TC-WAR-12): Từ chối thì đóng được ngay; Đã xử lý thì
 * mọi dòng phải có kết quả và hướng xử lý, mọi chứng từ đã ghi sổ.
 */
export function assertClosable(
  status: WarrantyStatus,
  lines: readonly { readonly disposition: WarrantyDisposition | null; readonly inspectionResult: WarrantyInspectionResult | null }[],
  documents: readonly { readonly status: WarrantyDocumentStatus }[],
): void {
  if (status === 'REJECTED') return;
  if (status === 'CLOSED') assertWarrantyTransition(status, 'CLOSED');
  if (lines.some((line) => !line.inspectionResult || !line.disposition)) {
    throw new CrmConflictError('LINES_UNRESOLVED', 'Còn dòng chưa xử lý.');
  }
  assertWarrantyTransition(status, 'CLOSED');
  const open = documents.filter((document) => document.status !== 'POSTED');
  if (open.length) {
    throw new CrmConflictError(
      'DOCUMENTS_NOT_POSTED',
      `Còn ${open.length} chứng từ chưa ghi sổ; chỉ đóng được khi mọi chứng từ đã ghi sổ.`,
    );
  }
}

/** Số tiền hoàn, giảm trừ của một dòng: giá trị dòng đơn (gồm VAT) theo số lượng trả. */
export function lineRefundAmount(orderLine: { readonly quantity: number; readonly lineTotal: number }, quantity: number): number {
  if (!(orderLine.quantity > 0)) return 0;
  return Math.round((orderLine.lineTotal / orderLine.quantity) * quantity * 100) / 100;
}
