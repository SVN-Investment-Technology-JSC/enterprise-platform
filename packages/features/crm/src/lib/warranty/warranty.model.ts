import type {
  CrmCapabilities,
  WarrantyCaseDetail,
  WarrantyCoverage,
  WarrantyDisposition,
  WarrantyDocumentStatus,
  WarrantyInspectionResult,
  WarrantyStatus,
} from '@enterprise-platform/contracts-crm';
import { formatDay } from '../fulfillment.model';

/**
 * Logic thuần của màn bảo hành (không React): nhãn, màu trạng thái, nút nào
 * hiện theo trạng thái và quyền. Server kiểm lại mọi thao tác.
 */

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const WARRANTY_STATUS_TONE: Readonly<Record<WarrantyStatus, Tone>> = {
  RECEIVED: 'neutral',
  AWAITING_GOODS: 'warning',
  INSPECTING: 'info',
  RESOLVING: 'info',
  RESOLVED: 'success',
  REJECTED: 'danger',
  CLOSED: 'neutral',
};

export const WARRANTY_DOCUMENT_TONE: Readonly<Record<WarrantyDocumentStatus, Tone>> = {
  PENDING: 'danger',
  REQUESTED: 'warning',
  PENDING_APPROVAL: 'warning',
  PENDING_RECEIVABLE: 'warning',
  POSTED: 'success',
  REVERSED: 'danger',
};

/** Nhãn thao tác trong nhật ký yêu cầu bảo hành và dòng thời gian khách. */
export const WARRANTY_ACTION_LABELS: Readonly<Record<string, string>> = {
  create: 'Tiếp nhận',
  reject: 'Từ chối',
  'request-goods': 'Gửi nhập trả về kho cách ly',
  'goods-received': 'Kho đã nhận hàng',
  inspect: 'Ghi kết quả kiểm định',
  'resolve-line': 'Chọn hướng xử lý',
  resolve: 'Đã sinh đủ chứng từ',
  'replacement-issued': 'Kho đã xuất hàng thay thế',
  'document-posted': 'Kho đã ghi sổ chứng từ',
  'document-reversed': 'Kho đã đảo chứng từ',
  close: 'Đóng yêu cầu',
};

/** Hướng xử lý chọn được theo kết quả kiểm định. */
export function dispositionsFor(result: WarrantyInspectionResult | null): WarrantyDisposition[] {
  if (result === 'PASSED') return ['RESTOCK'];
  if (result === 'DEFECTIVE') return ['MOVE_TO_DEFECT', 'SCRAP'];
  return [];
}

/** Hạn bảo hành dạng đọc được: "Còn 273 ngày (đến 27/07/2027)" hoặc "Hết hạn bảo hành". */
export function coverageLabel(coverage: WarrantyCoverage): string {
  if (coverage.expired) {
    return coverage.warrantyUntil ? `Hết hạn bảo hành (từ sau ${formatDay(coverage.warrantyUntil)})` : 'Không có bảo hành';
  }
  return `Còn ${coverage.remainingDays} ngày (đến ${formatDay(coverage.warrantyUntil)})`;
}

export type WarrantyUiAction = 'receive' | 'reject' | 'inspect' | 'resolve' | 'sync' | 'close';

/**
 * Nút hiện trên yêu cầu theo trạng thái và quyền `crm.warranty.write`:
 * Tiếp nhận: nhận hàng, từ chối; Chờ nhận hàng: gửi lại lệnh nhập trả khi chưa
 * gửi được; Đang kiểm định: ghi kết quả; Đang xử lý: chọn hướng xử lý; Đang xử
 * lý, Đã xử lý: gửi lại chứng từ còn thiếu; Đã xử lý, Từ chối: đóng.
 */
export function warrantyActions(
  detail: Pick<WarrantyCaseDetail, 'status' | 'documents'>,
  capabilities: CrmCapabilities,
): WarrantyUiAction[] {
  if (!(capabilities.isTenantAdmin || capabilities.canWriteWarranty)) return [];
  const actions: WarrantyUiAction[] = [];
  const receipt = detail.documents.find((document) => document.kind === 'RETURN_RECEIPT');
  if (detail.status === 'RECEIVED') actions.push('receive', 'reject');
  if (detail.status === 'AWAITING_GOODS' && receipt?.status !== 'POSTED') actions.push('receive');
  if (detail.status === 'INSPECTING') actions.push('inspect');
  if (detail.status === 'RESOLVING') actions.push('resolve');
  const resend = detail.documents.some((document) => document.status === 'PENDING' || document.status === 'PENDING_RECEIVABLE');
  if ((detail.status === 'RESOLVING' || detail.status === 'RESOLVED') && resend) actions.push('sync');
  if (detail.status === 'RESOLVED' || detail.status === 'REJECTED') actions.push('close');
  return actions;
}

/** Nhãn bước trong lịch sử serial của Kho. */
export const SERIAL_MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  TRANSFER: 'Điều chuyển',
  RETURN: 'Nhập trả',
  WARRANTY_ISSUE: 'Xuất bảo hành',
  ADJUSTMENT: 'Điều chỉnh',
  REVERSAL: 'Đảo chứng từ',
  QUALITY_CHANGE: 'Đổi trạng thái chất lượng',
};
