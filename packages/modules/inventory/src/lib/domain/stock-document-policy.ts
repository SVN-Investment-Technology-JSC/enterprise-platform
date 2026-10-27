import type {
  StockDocument,
  StockDocumentLineDirection,
  StockDocumentStatus,
  StockDocumentType,
} from '@enterprise-platform/contracts-inventory';
import {
  InventoryError,
  InvalidStockDocumentTransitionError,
  PostedStockDocumentError,
  StockDocumentSelfApprovalError,
} from './inventory.error.js';

/**
 * Máy trạng thái chứng từ kho (kế hoạch mục 5.6) và quy tắc duyệt (INV-02).
 *
 * Hàm thuần, không đụng DB: store gọi các hàm này trên bản ghi đã khoá
 * `FOR UPDATE`, nên kết luận luôn dựa trên trạng thái mới nhất.
 */

export const STOCK_DOCUMENT_STATUS_LABELS: Readonly<Record<StockDocumentStatus, string>> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã huỷ',
};

/**
 * Các bước chuyển có trong sơ đồ. Từ chối → Nháp xảy ra khi người lập sửa lại
 * chứng từ bị từ chối. Đã ghi sổ và Đã huỷ là trạng thái cuối.
 */
export const STOCK_DOCUMENT_TRANSITIONS: Readonly<
  Record<StockDocumentStatus, readonly StockDocumentStatus[]>
> = {
  DRAFT: ['PENDING', 'POSTED', 'CANCELLED'],
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['POSTED', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  POSTED: [],
  CANCELLED: [],
};

/** Nhập khác, xuất khác, điều chỉnh không có chứng từ nguồn đã duyệt nên phải qua người duyệt. */
const APPROVAL_REQUIRED: ReadonlySet<StockDocumentType> = new Set<StockDocumentType>([
  'RECEIPT_OTHER',
  'ISSUE_OTHER',
  'ADJUSTMENT',
]);

export function requiresApproval(docType: StockDocumentType): boolean {
  return APPROVAL_REQUIRED.has(docType);
}

export function isReceiptType(docType: StockDocumentType): boolean {
  return docType.startsWith('RECEIPT_');
}

export function isIssueType(docType: StockDocumentType): boolean {
  return docType.startsWith('ISSUE_');
}

/**
 * Chuyển có hợp lệ với loại chứng từ không. Khác sơ đồ thuần ở một chỗ: Nháp →
 * Đã ghi sổ chỉ dành cho loại có nguồn đã duyệt; ba loại phải duyệt thì phải đi
 * qua Chờ duyệt, Đã duyệt.
 */
export function canTransition(
  docType: StockDocumentType,
  from: StockDocumentStatus,
  to: StockDocumentStatus,
): boolean {
  if (!STOCK_DOCUMENT_TRANSITIONS[from].includes(to)) return false;
  if (from === 'DRAFT' && to === 'POSTED' && requiresApproval(docType)) return false;
  return true;
}

export function assertTransition(
  document: Pick<StockDocument, 'docType' | 'status'>,
  to: StockDocumentStatus,
): void {
  if (canTransition(document.docType, document.status, to)) return;
  const from = STOCK_DOCUMENT_STATUS_LABELS[document.status];
  if (document.status === 'POSTED') {
    throw new InvalidStockDocumentTransitionError(
      `Chứng từ đã ghi sổ không đổi trạng thái được; sai thì tạo chứng từ đảo.`,
    );
  }
  if (document.status === 'DRAFT' && to === 'POSTED') {
    throw new InvalidStockDocumentTransitionError(
      'Chứng từ loại này phải được duyệt trước khi ghi sổ.',
    );
  }
  throw new InvalidStockDocumentTransitionError(
    `Không thể chuyển chứng từ từ trạng thái ${from} sang ${STOCK_DOCUMENT_STATUS_LABELS[to]}.`,
  );
}

/** Chỉ sửa được chứng từ Nháp hoặc Từ chối (sửa xong quay về Nháp). */
export function assertEditable(document: Pick<StockDocument, 'status'>): void {
  if (document.status === 'POSTED') throw new PostedStockDocumentError();
  if (document.status !== 'DRAFT' && document.status !== 'REJECTED') {
    throw new InvalidStockDocumentTransitionError(
      `Chỉ sửa được chứng từ ở trạng thái Nháp hoặc Từ chối; chứng từ đang ở trạng thái ${STOCK_DOCUMENT_STATUS_LABELS[document.status]}.`,
    );
  }
}

/** Người lập không tự duyệt, trừ khi cài đặt `documents.approval.allowSelfApproval` bật (Q5). */
export function assertNotSelfApproval(
  document: Pick<StockDocument, 'createdBy'>,
  approverId: string,
  allowSelfApproval: boolean,
): void {
  if (!allowSelfApproval && document.createdBy === approverId) {
    throw new StockDocumentSelfApprovalError();
  }
}

/** Chứng từ đảo chỉ tạo từ chứng từ đã ghi sổ, và không đảo một chứng từ đảo. */
export function assertReversible(
  document: Pick<StockDocument, 'status' | 'reversesDocumentId' | 'code'>,
): void {
  if (document.status !== 'POSTED') {
    throw new InvalidStockDocumentTransitionError(
      `Chỉ đảo được chứng từ đã ghi sổ; chứng từ ${document.code} đang ở trạng thái ${STOCK_DOCUMENT_STATUS_LABELS[document.status]}.`,
    );
  }
  if (document.reversesDocumentId) {
    throw new InvalidStockDocumentTransitionError(
      `Chứng từ ${document.code} là chứng từ đảo, không đảo lại được.`,
    );
  }
}

/**
 * Chiều của dòng theo loại chứng từ. Nhập luôn IN, xuất và điều chuyển luôn OUT
 * (điều chuyển sinh vế nhập ở kho đích lúc ghi sổ); điều chỉnh bắt buộc ghi rõ.
 */
export function resolveLineDirection(
  docType: StockDocumentType,
  requested: StockDocumentLineDirection | undefined,
  lineNo: number,
): StockDocumentLineDirection {
  if (requested !== undefined && requested !== 'IN' && requested !== 'OUT') {
    throw new InventoryError('VALIDATION', `Dòng ${lineNo}: chiều nhập xuất không hợp lệ.`);
  }
  if (docType === 'ADJUSTMENT') {
    if (!requested) {
      throw new InventoryError(
        'VALIDATION',
        `Dòng ${lineNo}: chứng từ điều chỉnh phải ghi rõ tăng (IN) hay giảm (OUT).`,
      );
    }
    return requested;
  }
  const expected: StockDocumentLineDirection = isReceiptType(docType) ? 'IN' : 'OUT';
  if (requested && requested !== expected) {
    throw new InventoryError(
      'VALIDATION',
      expected === 'IN'
        ? `Dòng ${lineNo}: chứng từ nhập chỉ có dòng nhập.`
        : `Dòng ${lineNo}: chứng từ xuất hoặc điều chuyển chỉ có dòng xuất.`,
    );
  }
  return expected;
}
