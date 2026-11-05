import type {
  CreateStockDocumentRequest,
  Lot,
  Material,
  Reservation,
  StockDocument,
  StockDocumentLine,
  StockDocumentLineDirection,
  StockDocumentLineInput,
  StockDocumentStatus,
  StockDocumentType,
} from '@enterprise-platform/contracts-inventory';

/**
 * Logic thuần của màn chứng từ kho (T1-28 đến T1-31): nhãn, nút theo trạng thái
 * và quyền, kiểm form, chia dòng theo lô FEFO, tiến độ yêu cầu xuất. Không gọi
 * API, không đụng React, để test được độc lập. Server vẫn kiểm lại mọi quy tắc;
 * ở đây chỉ để báo lỗi sớm bằng tiếng Việt và ẩn nút không dùng được.
 */

export const STOCK_DOCUMENT_TYPE_LABEL: Readonly<Record<StockDocumentType, string>> = {
  RECEIPT_PURCHASE: 'Nhập mua hàng',
  RECEIPT_SALES_RETURN: 'Nhập trả hàng bán',
  RECEIPT_TRANSFER: 'Nhập điều chuyển',
  RECEIPT_OTHER: 'Nhập khác',
  ISSUE_SALES: 'Xuất bán hàng',
  ISSUE_PROJECT: 'Xuất cho dự án',
  ISSUE_WARRANTY: 'Xuất bảo hành',
  ISSUE_TRANSFER: 'Xuất điều chuyển',
  ISSUE_OTHER: 'Xuất khác',
  ADJUSTMENT: 'Điều chỉnh tồn',
  TRANSFER: 'Điều chuyển kho',
};

export const STOCK_DOCUMENT_STATUS_LABEL: Readonly<Record<StockDocumentStatus, string>> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã huỷ',
};

/** Màu trạng thái theo quy chuẩn: Violet khởi tạo, Amber chờ duyệt, Emerald thành công, Crimson lỗi. */
export const STOCK_DOCUMENT_STATUS_BADGE: Readonly<
  Record<StockDocumentStatus, { bg: string; text: string; border: string }>
> = {
  DRAFT: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  PENDING: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  APPROVED: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  REJECTED: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
  POSTED: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  CANCELLED: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
};

/** Nguồn chứng từ hay gặp; giá trị khác hiện nguyên văn. */
export function sourceTypeLabel(value?: string): string {
  if (!value) return 'Không có nguồn';
  const known: Record<string, string> = {
    crm_order: 'Đơn bán',
    crm_sales_order: 'Đơn bán',
    crm_delivery: 'Đợt giao hàng',
    crm_warranty: 'Bảo hành',
    crm_return: 'Trả hàng',
  };
  return known[value] ?? value;
}

/** Loại chứng từ người dùng tự lập trên màn Kho. Xuất bán, xuất bảo hành, nhập trả đến từ Bán hàng. */
export const MANUAL_DOCUMENT_TYPES: readonly StockDocumentType[] = [
  'RECEIPT_PURCHASE',
  'RECEIPT_OTHER',
  'ISSUE_PROJECT',
  'ISSUE_OTHER',
  'TRANSFER',
  'ADJUSTMENT',
];

/** Loại chứng từ xuất do Bán hàng yêu cầu, thủ kho chọn lô, serial rồi ghi sổ (T1-31). */
export const ISSUE_REQUEST_TYPES: readonly StockDocumentType[] = ['ISSUE_SALES', 'ISSUE_WARRANTY'];

/** Nhập khác, xuất khác, điều chỉnh phải qua người duyệt (kế hoạch mục 5.6, INV-02). */
const APPROVAL_REQUIRED: ReadonlySet<StockDocumentType> = new Set<StockDocumentType>([
  'RECEIPT_OTHER',
  'ISSUE_OTHER',
  'ADJUSTMENT',
]);

/** Ghi sổ bắt buộc đủ serial cho mặt hàng theo serial. */
const SERIALS_REQUIRED: ReadonlySet<StockDocumentType> = new Set<StockDocumentType>([
  'ISSUE_SALES',
  'ISSUE_WARRANTY',
  'RECEIPT_SALES_RETURN',
]);

export function requiresApproval(docType: StockDocumentType): boolean {
  return APPROVAL_REQUIRED.has(docType);
}

export function requiresSerials(docType: StockDocumentType): boolean {
  return SERIALS_REQUIRED.has(docType);
}

export function isReceiptType(docType: StockDocumentType): boolean {
  return docType.startsWith('RECEIPT_');
}

/** Chiều của dòng: nhập luôn IN, xuất và điều chuyển luôn OUT, điều chỉnh theo người lập chọn. */
export function lineDirection(
  docType: StockDocumentType,
  chosen?: StockDocumentLineDirection,
): StockDocumentLineDirection | undefined {
  if (docType === 'ADJUSTMENT') return chosen;
  return isReceiptType(docType) ? 'IN' : 'OUT';
}

// ---------------------------------------------------------------- Nút theo trạng thái

export type StockDocumentAction =
  | 'edit'
  | 'submit'
  | 'post'
  | 'cancel'
  | 'approve'
  | 'reject'
  | 'reverse';

export interface StockDocumentCapabilities {
  readonly canWriteTransactions: boolean;
  readonly canApproveDocuments: boolean;
}

export const STOCK_DOCUMENT_ACTION_LABEL: Readonly<Record<StockDocumentAction, string>> = {
  edit: 'Sửa',
  submit: 'Gửi duyệt',
  post: 'Ghi sổ',
  cancel: 'Huỷ chứng từ',
  approve: 'Duyệt',
  reject: 'Từ chối',
  reverse: 'Tạo chứng từ đảo',
};

/**
 * Nút hiện cho một chứng từ, theo máy trạng thái mục 5.6 và quyền của người xem.
 * Bị từ chối thì chỉ sửa được (sửa xong quay về Nháp); chứng từ đảo không đảo lại.
 */
export function availableDocumentActions(
  document: Pick<StockDocument, 'docType' | 'status' | 'reversesDocumentId'>,
  capabilities: StockDocumentCapabilities,
): StockDocumentAction[] {
  const writer = capabilities.canWriteTransactions;
  const approver = capabilities.canApproveDocuments;
  const actions: StockDocumentAction[] = [];
  switch (document.status) {
    case 'DRAFT':
      if (writer) {
        actions.push('edit');
        actions.push(requiresApproval(document.docType) ? 'submit' : 'post');
        actions.push('cancel');
      }
      break;
    case 'REJECTED':
      if (writer) actions.push('edit');
      break;
    case 'PENDING':
      if (approver) actions.push('approve', 'reject');
      if (writer) actions.push('cancel');
      break;
    case 'APPROVED':
      if (writer) actions.push('post', 'cancel');
      break;
    case 'POSTED':
      if (writer && !document.reversesDocumentId) actions.push('reverse');
      break;
    case 'CANCELLED':
      break;
  }
  return actions;
}

// ---------------------------------------------------------------- Bản nháp của form

export interface DraftLine {
  /** Khoá tạm cho lưới; không gửi lên server. */
  readonly key: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly direction?: StockDocumentLineDirection;
  readonly unitCost?: number;
  readonly lotNo?: string;
  readonly lotExpiresOn?: string;
  readonly lotManufacturedOn?: string;
  readonly serials: readonly string[];
  readonly reservationId?: string;
  readonly sourceLineId?: string;
  readonly note?: string;
}

export interface DocumentDraft {
  readonly docType: StockDocumentType;
  readonly warehouseCode: string;
  readonly targetWarehouseCode?: string;
  /** YYYY-MM-DD. */
  readonly documentDate: string;
  readonly note?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly lines: readonly DraftLine[];
}

let lineSequence = 0;
export function newLineKey(): string {
  lineSequence += 1;
  return `line-${Date.now().toString(36)}-${lineSequence}`;
}

export function emptyLine(): DraftLine {
  return { key: newLineKey(), materialCode: '', quantity: 1, serials: [] };
}

/** Ngày hôm nay theo giờ máy người dùng, dạng YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function emptyDraft(docType: StockDocumentType = 'RECEIPT_PURCHASE', warehouseCode = ''): DocumentDraft {
  return { docType, warehouseCode, documentDate: todayIso(), lines: [emptyLine()] };
}

/** Chứng từ đã có thành bản nháp để sửa (chỉ Nháp hoặc Từ chối). */
export function documentToDraft(document: StockDocument): DocumentDraft {
  return {
    docType: document.docType,
    warehouseCode: document.warehouseCode,
    targetWarehouseCode: document.targetWarehouseCode,
    documentDate: document.documentDate,
    note: document.note,
    sourceType: document.sourceType,
    sourceId: document.sourceId,
    lines: document.lines.map(lineToDraft),
  };
}

export function lineToDraft(line: StockDocumentLine): DraftLine {
  return {
    key: newLineKey(),
    materialCode: line.materialCode,
    quantity: line.quantity,
    direction: line.direction,
    unitCost: line.unitCost || undefined,
    lotNo: line.lotNo,
    lotExpiresOn: line.lotExpiresOn,
    serials: line.serials ?? [],
    reservationId: line.reservationId,
    sourceLineId: line.sourceLineId,
    note: line.note,
  };
}

/** Dòng nháp thành dòng gửi API: bỏ trường trống, chỉ gửi serial khi có. */
export function draftLineToInput(docType: StockDocumentType, line: DraftLine): StockDocumentLineInput {
  const direction = lineDirection(docType, line.direction);
  const inbound = direction === 'IN';
  const lotNo = line.lotNo?.trim();
  return {
    materialCode: line.materialCode.trim(),
    quantity: Number(line.quantity),
    ...(docType === 'ADJUSTMENT' && direction ? { direction } : {}),
    ...(inbound && line.unitCost !== undefined && line.unitCost !== null ? { unitCost: Number(line.unitCost) } : {}),
    ...(lotNo
      ? {
          lot: {
            lotNo,
            ...(inbound && line.lotExpiresOn ? { expiresOn: line.lotExpiresOn } : {}),
            ...(inbound && line.lotManufacturedOn ? { manufacturedOn: line.lotManufacturedOn } : {}),
          },
        }
      : {}),
    ...(line.serials.length ? { serials: [...line.serials] } : {}),
    ...(line.reservationId ? { reservationId: line.reservationId } : {}),
    ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
    ...(line.note?.trim() ? { note: line.note.trim() } : {}),
  };
}

export function draftToCreateRequest(draft: DocumentDraft): CreateStockDocumentRequest {
  return {
    docType: draft.docType,
    warehouseCode: draft.warehouseCode.trim(),
    ...(draft.docType === 'TRANSFER' && draft.targetWarehouseCode
      ? { targetWarehouseCode: draft.targetWarehouseCode.trim() }
      : {}),
    documentDate: draft.documentDate,
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
    ...(draft.sourceType?.trim() ? { sourceType: draft.sourceType.trim() } : {}),
    ...(draft.sourceId?.trim() ? { sourceId: draft.sourceId.trim() } : {}),
    lines: draft.lines.map((line) => draftLineToInput(draft.docType, line)),
  };
}

// ---------------------------------------------------------------- Kiểm form

export interface DraftValidation {
  /** Lỗi của phần đầu chứng từ. */
  readonly header: readonly string[];
  /** Lỗi theo khoá dòng. */
  readonly lines: Readonly<Record<string, readonly string[]>>;
  readonly valid: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kiểm bản nháp trước khi gửi. `forPosting`: kiểm thêm điều kiện ghi sổ (đủ
 * serial cho xuất bán, xuất bảo hành, nhập trả; đủ serial khi đã bắt đầu chọn).
 */
export function validateDraft(
  draft: DocumentDraft,
  materials: ReadonlyMap<string, Pick<Material, 'code' | 'isSerialized' | 'kind' | 'isActive'>>,
  options: { readonly forPosting?: boolean } = {},
): DraftValidation {
  const header: string[] = [];
  const lines: Record<string, string[]> = {};
  if (!draft.docType) header.push('Chọn loại chứng từ.');
  if (!draft.warehouseCode.trim()) header.push('Chọn kho.');
  if (draft.docType === 'TRANSFER') {
    if (!draft.targetWarehouseCode?.trim()) header.push('Chứng từ điều chuyển phải có kho đến.');
    else if (draft.targetWarehouseCode.trim() === draft.warehouseCode.trim()) {
      header.push('Kho đi và kho đến phải khác nhau.');
    }
  }
  if (!DATE_PATTERN.test(draft.documentDate)) header.push('Ngày chứng từ không hợp lệ.');
  if (draft.sourceId?.trim() && !UUID_PATTERN.test(draft.sourceId.trim())) {
    header.push('Mã chứng từ nguồn không hợp lệ.');
  }
  if (draft.lines.length === 0) header.push('Chứng từ phải có ít nhất một dòng.');

  const serialOwner = new Map<string, number>();
  draft.lines.forEach((line, index) => {
    const lineNo = index + 1;
    const errors: string[] = [];
    const code = line.materialCode.trim();
    const material = code ? materials.get(code) : undefined;
    const direction = lineDirection(draft.docType, line.direction);
    if (!code) errors.push('Chọn mặt hàng.');
    else if (!material) errors.push(`Không tìm thấy mặt hàng ${code}.`);
    else if (material.kind === 'SERVICE') errors.push('Mặt hàng dịch vụ không quản lý tồn.');
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push('Số lượng phải lớn hơn 0.');
    if (draft.docType === 'ADJUSTMENT' && !direction) errors.push('Chọn tăng hay giảm tồn.');
    if (line.unitCost !== undefined && (!Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0)) {
      errors.push('Đơn giá không được âm.');
    }
    if (line.lotNo?.trim() && line.serials.length) errors.push('Một dòng chỉ ghi lô hoặc serial, không ghi cả hai.');
    if (direction === 'IN' && (line.lotExpiresOn || line.lotManufacturedOn) && !line.lotNo?.trim()) {
      errors.push('Có hạn dùng thì phải ghi số lô.');
    }
    if (line.lotExpiresOn && line.lotManufacturedOn && line.lotManufacturedOn > line.lotExpiresOn) {
      errors.push('Ngày sản xuất phải trước hạn dùng.');
    }
    if (material?.isSerialized && Number.isFinite(quantity) && quantity > 0) {
      if (!Number.isInteger(quantity)) errors.push('Mặt hàng theo serial phải có số lượng nguyên.');
      const picked = line.serials.length;
      const mustHave = options.forPosting && requiresSerials(draft.docType);
      if (picked > 0 && picked !== quantity) {
        errors.push(`Đã chọn ${picked}/${quantity} serial; số serial phải bằng số lượng.`);
      } else if (picked === 0 && mustHave) {
        errors.push(`Chưa chọn serial (cần ${quantity}).`);
      }
    } else if (!material?.isSerialized && line.serials.length && material) {
      errors.push('Mặt hàng này không quản lý theo serial.');
    }
    for (const serial of line.serials) {
      const key = `${code}::${serial.toUpperCase()}`;
      const owner = serialOwner.get(key);
      if (owner !== undefined && owner !== lineNo) errors.push(`Serial ${serial} đã có ở dòng ${owner}.`);
      else serialOwner.set(key, lineNo);
    }
    if (errors.length) lines[line.key] = errors.map((message) => `Dòng ${lineNo}: ${message}`);
  });
  return { header, lines, valid: header.length === 0 && Object.keys(lines).length === 0 };
}

export function validationMessages(result: DraftValidation): string[] {
  return [...result.header, ...Object.values(result.lines).flat()];
}

// ---------------------------------------------------------------- Lô theo FEFO

export interface LotOption {
  readonly lotNo: string;
  readonly expiresOn?: string;
  readonly manufacturedOn?: string;
  readonly qualityStatus: Lot['qualityStatus'];
  /** Khả dụng tại kho đang xuất. */
  readonly available: number;
  /** Lý do không dùng được; trống là dùng được. */
  readonly blockedReason?: string;
}

/**
 * Lô của mặt hàng tại một kho, xếp theo FEFO (hạn gần nhất trước, lô không hạn
 * xếp cuối). Lô hết hạn, lô không Đạt, lô hết hàng ở kho này vẫn hiện nhưng có
 * lý do, giống quy tắc gợi ý của server (`GET v1/lots/suggest`).
 */
export function lotOptionsForWarehouse(lots: readonly Lot[], warehouseCode: string, today: string): LotOption[] {
  return lots
    .filter((lot) => lot.balances.some((item) => item.warehouseCode === warehouseCode && item.quantity > 0))
    .map((lot) => {
      const balance = lot.balances.find((item) => item.warehouseCode === warehouseCode);
      const available = balance?.available ?? 0;
      const blockedReason =
        lot.expiresOn && lot.expiresOn < today
          ? 'Hết hạn'
          : lot.qualityStatus !== 'PASSED'
            ? 'Không ở trạng thái Đạt'
            : available <= 0
              ? 'Hết hàng ở kho này'
              : undefined;
      return {
        lotNo: lot.lotNo,
        expiresOn: lot.expiresOn,
        manufacturedOn: lot.manufacturedOn,
        qualityStatus: lot.qualityStatus,
        available,
        blockedReason,
      };
    })
    .sort(compareFefo);
}

function compareFefo(left: Pick<LotOption, 'expiresOn' | 'lotNo'>, right: Pick<LotOption, 'expiresOn' | 'lotNo'>): number {
  const byExpiry = (left.expiresOn ?? '9999-12-31').localeCompare(right.expiresOn ?? '9999-12-31');
  return byExpiry !== 0 ? byExpiry : left.lotNo.localeCompare(right.lotNo);
}

export interface LotAllocation {
  readonly lotNo: string;
  readonly expiresOn?: string;
  readonly quantity: number;
}

/** Chia số lượng cho các lô dùng được theo FEFO; `shortage` > 0 khi các lô không đủ. */
export function allocateFefo(
  options: readonly LotOption[],
  quantity: number,
): { allocations: LotAllocation[]; allocated: number; shortage: number } {
  let remaining = quantity;
  const allocations: LotAllocation[] = [];
  for (const option of [...options].sort(compareFefo)) {
    if (remaining <= 0) break;
    if (option.blockedReason || option.available <= 0) continue;
    const take = Math.min(option.available, remaining);
    allocations.push({ lotNo: option.lotNo, expiresOn: option.expiresOn, quantity: take });
    remaining -= take;
  }
  const allocated = quantity - Math.max(remaining, 0);
  return { allocations, allocated, shortage: Math.max(remaining, 0) };
}

/**
 * Một dòng xuất lấy từ nhiều lô thành nhiều dòng, mỗi dòng một lô; giữ giữ hàng,
 * ghi chú của dòng gốc. Không có phân bổ thì trả lại dòng gốc, bỏ lô.
 */
export function splitLineByLots(line: DraftLine, allocations: readonly LotAllocation[]): DraftLine[] {
  const used = allocations.filter((item) => item.quantity > 0);
  if (used.length === 0) return [{ ...line, lotNo: undefined, lotExpiresOn: undefined }];
  return used.map((allocation, index) => ({
    ...line,
    key: index === 0 ? line.key : newLineKey(),
    quantity: allocation.quantity,
    lotNo: allocation.lotNo,
    lotExpiresOn: allocation.expiresOn,
    serials: [],
  }));
}

// ---------------------------------------------------------------- Serial

/** Tách chuỗi quét hoặc dán (xuống dòng, dấu phẩy, chấm phẩy, khoảng trắng) thành danh sách serial không trùng. */
export function parseSerialInput(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const serial = raw.trim();
    if (!serial) continue;
    const key = serial.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(serial);
  }
  return result;
}

/**
 * Thêm serial quét được vào danh sách đang chọn. Serial có trong danh sách cho
 * phép (nếu có) thì lấy đúng cách viết của kho; serial lạ hoặc vượt số lượng bị
 * từ chối kèm lý do.
 */
export function addScannedSerials(
  current: readonly string[],
  scanned: readonly string[],
  options: { readonly limit: number; readonly allowed?: readonly string[] },
): { serials: string[]; rejected: { serial: string; reason: string }[] } {
  const serials = [...current];
  const taken = new Set(current.map((serial) => serial.toUpperCase()));
  const allowed = options.allowed
    ? new Map(options.allowed.map((serial) => [serial.toUpperCase(), serial]))
    : undefined;
  const rejected: { serial: string; reason: string }[] = [];
  for (const raw of scanned) {
    const key = raw.toUpperCase();
    if (taken.has(key)) {
      rejected.push({ serial: raw, reason: 'đã chọn' });
      continue;
    }
    if (allowed && !allowed.has(key)) {
      rejected.push({ serial: raw, reason: 'không có trong kho hoặc không ở trạng thái Đạt' });
      continue;
    }
    if (serials.length >= options.limit) {
      rejected.push({ serial: raw, reason: 'vượt số lượng của dòng' });
      continue;
    }
    serials.push(allowed?.get(key) ?? raw);
    taken.add(key);
  }
  return { serials, rejected };
}

// ---------------------------------------------------------------- Yêu cầu xuất từ đơn bán

export interface IssueLineProgress {
  readonly line: StockDocumentLine;
  readonly reservationCode?: string;
  /** Số còn giữ chưa xuất của giữ hàng cho mặt hàng này; không có giữ hàng thì trống. */
  readonly outstanding?: number;
  readonly reserved?: number;
  readonly issued?: number;
  /** Số serial còn thiếu (chỉ mặt hàng theo serial). */
  readonly missingSerials: number;
}

/** Tiến độ từng dòng của chứng từ xuất: giữ hàng nào, còn bao nhiêu chưa xuất, thiếu bao nhiêu serial. */
export function issueLineProgress(
  document: Pick<StockDocument, 'warehouseId' | 'lines'>,
  reservations: readonly Reservation[],
  serializedCodes: ReadonlySet<string>,
): IssueLineProgress[] {
  const byId = new Map(reservations.map((item) => [item.id, item]));
  return document.lines.map((line) => {
    const reservation = line.reservationId ? byId.get(line.reservationId) : undefined;
    const item = reservation?.items?.find(
      (candidate) => candidate.materialId === line.materialId && candidate.warehouseId === document.warehouseId,
    ) ?? reservation?.items?.find((candidate) => candidate.materialId === line.materialId);
    const missingSerials = serializedCodes.has(line.materialCode)
      ? Math.max(Math.trunc(line.quantity) - (line.serials?.length ?? 0), 0)
      : 0;
    return {
      line,
      reservationCode: reservation?.reservationCode,
      reserved: item?.quantityReserved,
      issued: item?.quantityIssued,
      outstanding: item ? item.quantityReserved - item.quantityIssued : undefined,
      missingSerials,
    };
  });
}

/** Chứng từ xuất còn thiếu gì trước khi ghi sổ; rỗng là sẵn sàng. */
export function issueReadiness(progress: readonly IssueLineProgress[]): string[] {
  const problems: string[] = [];
  // Một giữ hàng có thể chia ra nhiều dòng (mỗi dòng một lô): so tổng các dòng với phần còn giữ.
  const totals = new Map<string, { quantity: number; item: IssueLineProgress }>();
  for (const item of progress) {
    if (item.missingSerials > 0) {
      problems.push(`Dòng ${item.line.lineNo} (${item.line.materialCode}): còn thiếu ${item.missingSerials} serial.`);
    }
    if (item.outstanding === undefined || !item.line.reservationId) continue;
    const key = `${item.line.reservationId}::${item.line.materialId}`;
    const total = totals.get(key);
    totals.set(key, { quantity: (total?.quantity ?? 0) + item.line.quantity, item: total?.item ?? item });
  }
  for (const { quantity, item } of totals.values()) {
    if (item.outstanding !== undefined && quantity > item.outstanding) {
      problems.push(
        `${item.line.materialCode}: xuất ${quantity} nhưng giữ hàng ${item.reservationCode ?? ''} chỉ còn ${item.outstanding}.`,
      );
    }
  }
  return problems;
}
