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
  StockDocumentApprovalRequiredError,
  StockDocumentSelfApprovalError,
  StockDocumentSelfReversalError,
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

/**
 * Nhập mua, xuất dự án chỉ ghi sổ thẳng khi có chứng từ nguồn (đơn mua, dự án,
 * tài sản); không nguồn thì như nhập khác, xuất khác: phải qua người duyệt (ISS-BE-006).
 */
const APPROVAL_REQUIRED_WITHOUT_SOURCE: ReadonlySet<StockDocumentType> = new Set<StockDocumentType>([
  'RECEIPT_PURCHASE',
  'ISSUE_PROJECT',
]);

/** Chứng từ cụ thể có phải qua bước duyệt trước khi ghi sổ không (xét cả chứng từ nguồn). */
export function documentRequiresApproval(
  document: Pick<StockDocument, 'docType' | 'sourceId'>,
): boolean {
  if (APPROVAL_REQUIRED.has(document.docType)) return true;
  return APPROVAL_REQUIRED_WITHOUT_SOURCE.has(document.docType) && !document.sourceId?.trim();
}

/**
 * Đường ghi sổ được miễn bước duyệt vì đã có bước kiểm riêng (Q1). Bên gọi khai
 * tường minh qua `PostOptions.origin`; không suy từ loại chứng từ. Mỗi nguồn chỉ
 * áp cho đúng dạng chứng từ của nó, khai sai nguồn thì vẫn phải duyệt.
 */
export const POSTING_ORIGINS = [
  'stocktake',
  'asset_uninstall',
  'asset_return',
  'opening_balance',
  'reversal',
] as const;
export type PostingOrigin = (typeof POSTING_ORIGINS)[number];

type PostableDocument = Pick<
  StockDocument,
  'docType' | 'status' | 'sourceType' | 'sourceId' | 'reversesDocumentId'
>;

const ORIGIN_APPLIES: Readonly<Record<PostingOrigin, (document: PostableDocument) => boolean>> = {
  // Kiểm kê: đợt đã được người duyệt kiểm kê duyệt rồi mới ghi sổ cân kho.
  stocktake: (document) =>
    document.docType === 'ADJUSTMENT' && document.sourceType === 'stocktake' && Boolean(document.sourceId),
  // Tháo khỏi thiết bị, thanh lý thiết bị về kho: nguồn là tài sản trên cây.
  asset_uninstall: (document) =>
    document.docType === 'RECEIPT_OTHER' && document.sourceType === 'asset' && Boolean(document.sourceId),
  asset_return: (document) =>
    document.docType === 'RECEIPT_OTHER' && document.sourceType === 'asset' && Boolean(document.sourceId),
  // Số dư đầu kỳ của nhập dữ liệu ban đầu (gọi nội bộ bằng token dịch vụ).
  opening_balance: (document) =>
    document.docType === 'RECEIPT_PURCHASE' && document.sourceType === 'OPENING_BALANCE',
  // Chứng từ đảo: quyền duyệt và người đảo khác người lập đã kiểm ở service.
  reversal: (document) => Boolean(document.reversesDocumentId),
};

export function isExemptOrigin(document: PostableDocument, origin: PostingOrigin | undefined): boolean {
  return origin !== undefined && ORIGIN_APPLIES[origin]?.(document) === true;
}

/**
 * Chứng từ được ghi sổ ở trạng thái hiện tại không (ISS-BE-006). Mọi đường ghi
 * sổ (ghi ngay lúc tạo, ghi chứng từ đã duyệt, đảo) đều đi qua đây ngay trước khi
 * đụng sổ cái: chứng từ cần duyệt chỉ ghi được khi Đã duyệt, trừ nguồn miễn.
 */
export function assertPostable(
  document: PostableDocument,
  context: { readonly origin?: PostingOrigin } = {},
): void {
  if (document.status === 'APPROVED') return;
  if (!documentRequiresApproval(document)) return;
  if (isExemptOrigin(document, context.origin)) return;
  throw new StockDocumentApprovalRequiredError();
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
  sourceId?: string,
): boolean {
  if (!STOCK_DOCUMENT_TRANSITIONS[from].includes(to)) return false;
  if (from === 'DRAFT' && to === 'POSTED' && documentRequiresApproval({ docType, sourceId })) {
    return false;
  }
  return true;
}

export function assertTransition(
  document: Pick<StockDocument, 'docType' | 'status'> & Partial<Pick<StockDocument, 'sourceId'>>,
  to: StockDocumentStatus,
): void {
  if (canTransition(document.docType, document.status, to, document.sourceId)) return;
  const from = STOCK_DOCUMENT_STATUS_LABELS[document.status];
  if (document.status === 'POSTED') {
    throw new InvalidStockDocumentTransitionError(
      `Chứng từ đã ghi sổ không đổi trạng thái được; sai thì tạo chứng từ đảo.`,
    );
  }
  if (document.status === 'DRAFT' && to === 'POSTED') {
    throw new StockDocumentApprovalRequiredError();
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

/** Người lập chứng từ gốc không tự đảo nó, cùng cài đặt tự duyệt như bước duyệt (ISS-BE-006, Q2). */
export function assertNotSelfReversal(
  original: Pick<StockDocument, 'createdBy'>,
  actorId: string,
  allowSelfApproval: boolean,
): void {
  if (!allowSelfApproval && original.createdBy === actorId) {
    throw new StockDocumentSelfReversalError();
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

/**
 * Chứng từ gắn với giao hàng, bảo hành, nhận hàng trả về: mặt hàng theo serial
 * phải có đủ serial LÚC GHI SỔ (thủ kho chọn serial trên chứng từ nháp rồi mới
 * ghi sổ). Chứng từ đảo chép serial của chứng từ gốc nên không kiểm lại; đường
 * nhập xuất cũ (loại khác) vẫn cho bỏ trống serial như trước.
 */
const SERIALS_REQUIRED_AT_POSTING: ReadonlySet<StockDocumentType> = new Set<StockDocumentType>([
  'ISSUE_SALES',
  'ISSUE_WARRANTY',
  'RECEIPT_SALES_RETURN',
]);

export function requiresSerialsAtPosting(docType: StockDocumentType, isReversal: boolean): boolean {
  return !isReversal && SERIALS_REQUIRED_AT_POSTING.has(docType);
}

/** Loại chứng từ phát sự kiện kho khi ghi sổ (T1-27). */
export function stockEventKind(docType: StockDocumentType): 'ISSUED' | 'RETURNED' | null {
  if (isIssueType(docType)) return 'ISSUED';
  if (docType === 'RECEIPT_SALES_RETURN') return 'RETURNED';
  return null;
}
