import {
  QUALITY_STATUSES,
  type QualityStatus,
  type SerialMovementType,
  type SerialStockState,
  type StockDocumentLineDirection,
  type StockDocumentLotInput,
  type StockDocumentType,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from './inventory.error.js';

/**
 * Quy tắc serial, lô và trạng thái chất lượng (INV-04, INV-05, INV-06).
 *
 * Hàm thuần, không đụng DB: service chuẩn hoá input bằng các hàm này, store kiểm
 * lại trên bản ghi đã khoá `FOR UPDATE` lúc ghi sổ.
 */

export const QUALITY_STATUS_LABELS: Readonly<Record<QualityStatus, string>> = {
  PASSED: 'Đạt',
  QUARANTINE: 'Cách ly',
  DEFECTIVE: 'Lỗi',
  PENDING_INSPECTION: 'Chờ kiểm định',
};

export const SERIAL_STOCK_STATE_LABELS: Readonly<Record<SerialStockState, string>> = {
  IN_STOCK: 'Trong kho',
  ISSUED: 'Đã xuất',
  IN_TRANSIT: 'Đang chuyển',
  SCRAPPED: 'Đã huỷ',
};

const MAX_SERIAL_LENGTH = 100;
const MAX_LOT_NO_LENGTH = 100;
const MAX_REASON_LENGTH = 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function isQualityStatus(value: unknown): value is QualityStatus {
  return typeof value === 'string' && (QUALITY_STATUSES as readonly string[]).includes(value);
}

/** Hàng ở trạng thái này không tính vào tồn khả dụng. */
export function isBlockingQuality(status: QualityStatus): boolean {
  return status !== 'PASSED';
}

/**
 * Khoá so sánh serial: bỏ khoảng trắng hai đầu, viết hoa. Cùng biểu thức với
 * unique index `upper(btrim(serial_number))` của migration 0013.
 */
export function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

/**
 * Chuẩn hoá danh sách serial của một dòng. Có serial thì số lượng phải là số
 * nguyên và bằng số serial; serial rỗng hoặc lặp lại trong dòng bị từ chối.
 */
export function normalizeLineSerials(
  serials: unknown,
  quantity: number,
  lineNo: number,
): string[] | undefined {
  if (serials === undefined || serials === null) return undefined;
  if (!Array.isArray(serials)) {
    throw new InventoryError('VALIDATION', `Dòng ${lineNo}: danh sách serial không hợp lệ.`);
  }
  if (serials.length === 0) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  serials.forEach((raw, index) => {
    const serial = typeof raw === 'string' ? raw.trim() : '';
    if (!serial) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: serial thứ ${index + 1} để trống.`);
    }
    if (serial.length > MAX_SERIAL_LENGTH) {
      throw new InventoryError(
        'VALIDATION',
        `Dòng ${lineNo}: serial ${serial.slice(0, 20)}… dài quá ${MAX_SERIAL_LENGTH} ký tự.`,
      );
    }
    const key = serialKey(serial);
    if (seen.has(key)) {
      throw new InventoryError('VALIDATION', `Dòng ${lineNo}: serial ${serial} bị lặp lại.`);
    }
    seen.add(key);
    result.push(serial);
  });
  if (!Number.isInteger(quantity) || quantity !== result.length) {
    throw new InventoryError(
      'VALIDATION',
      `Dòng ${lineNo}: số serial (${result.length}) phải bằng số lượng (${quantity}).`,
    );
  }
  return result;
}

/** Một serial chỉ xuất hiện một lần trong cả chứng từ (cùng mặt hàng). */
export function assertSerialsUniqueAcrossLines(
  lines: readonly { readonly materialCode: string; readonly serials?: readonly string[] }[],
): void {
  const owner = new Map<string, number>();
  lines.forEach((line, index) => {
    for (const serial of line.serials ?? []) {
      const key = `${line.materialCode}|${serialKey(serial)}`;
      const first = owner.get(key);
      if (first !== undefined) {
        throw new InventoryError(
          'VALIDATION',
          `Serial ${serial} của ${line.materialCode} có ở cả dòng ${first} và dòng ${index + 1}.`,
        );
      }
      owner.set(key, index + 1);
    }
  });
}

/** Số lô so sánh và lưu ở dạng bỏ khoảng trắng hai đầu, viết hoa. */
export function normalizeLotNo(value: unknown, lineNo?: number): string {
  const prefix = lineNo === undefined ? '' : `Dòng ${lineNo}: `;
  const lotNo = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!lotNo) throw new InventoryError('VALIDATION', `${prefix}số lô không được để trống.`);
  if (lotNo.length > MAX_LOT_NO_LENGTH) {
    throw new InventoryError('VALIDATION', `${prefix}số lô dài tối đa ${MAX_LOT_NO_LENGTH} ký tự.`);
  }
  return lotNo;
}

function optionalDate(value: unknown, label: string, prefix: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? value.trim() : '';
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    throw new InventoryError('VALIDATION', `${prefix}${label} phải có dạng YYYY-MM-DD.`);
  }
  return date;
}

function optionalText(value: unknown, max: number, label: string, prefix: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  if (text.length > max) {
    throw new InventoryError('VALIDATION', `${prefix}${label} dài tối đa ${max} ký tự.`);
  }
  return text;
}

/**
 * Chuẩn hoá lô của một dòng. Dòng nhập được khai ngày sản xuất, hạn dùng, nhà
 * cung cấp, số CO/CQ; dòng xuất chỉ dùng số lô (lô phải có sẵn).
 */
export function normalizeLotInput(
  input: StockDocumentLotInput | undefined | null,
  direction: StockDocumentLineDirection,
  lineNo?: number,
): StockDocumentLotInput | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object') {
    const prefix = lineNo === undefined ? '' : `Dòng ${lineNo}: `;
    throw new InventoryError('VALIDATION', `${prefix}thông tin lô không hợp lệ.`);
  }
  const lotNo = normalizeLotNo(input.lotNo, lineNo);
  if (direction === 'OUT') return { lotNo };
  const prefix = lineNo === undefined ? '' : `Dòng ${lineNo}: `;
  const manufacturedOn = optionalDate(input.manufacturedOn, 'ngày sản xuất', prefix);
  const expiresOn = optionalDate(input.expiresOn, 'hạn dùng', prefix);
  if (manufacturedOn && expiresOn && manufacturedOn > expiresOn) {
    throw new InventoryError('VALIDATION', `${prefix}ngày sản xuất phải trước hạn dùng.`);
  }
  return {
    lotNo,
    manufacturedOn,
    expiresOn,
    supplier: optionalText(input.supplier, 255, 'nhà cung cấp', prefix),
    certificateNo: optionalText(input.certificateNo, 100, 'số CO/CQ', prefix),
  };
}

/**
 * Xuất bán, xuất dự án, xuất bảo hành... chỉ lấy hàng Đạt. Điều chuyển và điều
 * chỉnh được mang hàng không Đạt (chuyển sang kho lỗi, huỷ hàng hỏng); phần không
 * Đạt đi theo hàng sang kho đích.
 */
export function requiresPassedQuality(
  docType: StockDocumentType,
  direction: StockDocumentLineDirection,
): boolean {
  // Xuất khác (có duyệt) dùng để loại bỏ hàng Lỗi, Cách ly (bảo hành, T6-05), nên không đòi Đạt.
  return direction === 'OUT' && docType.startsWith('ISSUE_') && docType !== 'ISSUE_OTHER';
}

/** Loại dòng lịch sử serial theo chứng từ. */
export function serialMovementType(
  docType: StockDocumentType,
  isReversal: boolean,
): SerialMovementType {
  if (isReversal) return 'REVERSAL';
  if (docType === 'TRANSFER') return 'TRANSFER';
  if (docType === 'ADJUSTMENT') return 'ADJUSTMENT';
  if (docType === 'RECEIPT_SALES_RETURN') return 'RETURN';
  if (docType === 'ISSUE_WARRANTY') return 'WARRANTY_ISSUE';
  return docType.startsWith('RECEIPT_') ? 'RECEIPT' : 'ISSUE';
}

/** Lý do bắt buộc khi đổi trạng thái chất lượng; trả lý do đã bỏ khoảng trắng. */
export function assertQualityChange(
  current: QualityStatus,
  next: unknown,
  reason: unknown,
  subject: string,
): { readonly to: QualityStatus; readonly reason: string } {
  if (!isQualityStatus(next)) {
    throw new InventoryError('VALIDATION', 'Trạng thái chất lượng không hợp lệ.');
  }
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new InventoryError('VALIDATION', 'Phải ghi lý do đổi trạng thái chất lượng.');
  if (text.length > MAX_REASON_LENGTH) {
    throw new InventoryError('VALIDATION', `Lý do dài tối đa ${MAX_REASON_LENGTH} ký tự.`);
  }
  if (current === next) {
    throw new InventoryError(
      'QUALITY_STATUS_UNCHANGED',
      `${subject} đang ở trạng thái ${QUALITY_STATUS_LABELS[current]}.`,
      409,
    );
  }
  return { to: next, reason: text };
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayInVietnam(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Lô dùng được đến hết ngày hạn dùng; sang ngày sau mới là hết hạn. */
export function isLotExpired(expiresOn: string | undefined, today: string): boolean {
  return expiresOn !== undefined && expiresOn < today;
}

export interface LotCandidate {
  readonly lotId: string;
  readonly lotNo: string;
  readonly expiresOn?: string;
  readonly manufacturedOn?: string;
  readonly qualityStatus: QualityStatus;
  /** Tồn khả dụng của lô tại kho đang xét. */
  readonly available: number;
}

export interface FefoAllocation {
  readonly lines: readonly (LotCandidate & { readonly quantity: number })[];
  readonly allocated: number;
  readonly shortage: number;
}

/**
 * Gợi ý lô theo FEFO (INV-09): hạn dùng gần nhất trước, lô không hạn dùng xếp
 * cuối; cùng hạn thì lô sản xuất trước, rồi theo số lô. Bỏ lô hết hạn, lô không
 * Đạt và lô không còn khả dụng.
 */
export function suggestLotsFefo(
  candidates: readonly LotCandidate[],
  quantity: number,
  today: string,
): FefoAllocation {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new InventoryError('VALIDATION', 'Số lượng cần xuất phải là số dương.');
  }
  const usable = candidates
    .filter(
      (lot) =>
        lot.qualityStatus === 'PASSED' && !isLotExpired(lot.expiresOn, today) && lot.available > 0,
    )
    .sort(
      (left, right) =>
        (left.expiresOn ?? '9999-12-31').localeCompare(right.expiresOn ?? '9999-12-31') ||
        (left.manufacturedOn ?? '9999-12-31').localeCompare(right.manufacturedOn ?? '9999-12-31') ||
        left.lotNo.localeCompare(right.lotNo),
    );
  const lines: (LotCandidate & { quantity: number })[] = [];
  let remaining = round3(quantity);
  // Trả mọi lô dùng được theo thứ tự FEFO để thủ kho thấy lô kế tiếp; lô sau khi
  // đã đủ số có `quantity` bằng 0.
  for (const lot of usable) {
    const take = round3(Math.max(Math.min(lot.available, remaining), 0));
    lines.push({ ...lot, quantity: take });
    remaining = round3(remaining - take);
  }
  return { lines, allocated: round3(quantity - remaining), shortage: Math.max(remaining, 0) };
}

/**
 * Tách số lượng xuất hoặc chuyển theo phân bổ lô (đường API cũ `issues`,
 * `transfers`): mỗi lô một phần, phần còn lại không theo lô. Lô lặp thì cộng dồn;
 * tổng phân bổ vượt số lượng thì từ chối.
 */
export function splitByLots(
  quantity: number,
  allocations: readonly { readonly lotNo: string; readonly quantity: number }[] | undefined,
): { readonly lotNo?: string; readonly quantity: number }[] {
  if (allocations === undefined || allocations === null) return [{ quantity }];
  if (!Array.isArray(allocations)) {
    throw new InventoryError('VALIDATION', 'Phân bổ lô không hợp lệ.');
  }
  const byLot = new Map<string, number>();
  for (const allocation of allocations) {
    const lotNo = normalizeLotNo(allocation?.lotNo);
    const part = Number(allocation?.quantity);
    if (!Number.isFinite(part) || part <= 0) {
      throw new InventoryError('VALIDATION', `Số lượng lấy từ lô ${lotNo} phải là số dương.`);
    }
    byLot.set(lotNo, round3((byLot.get(lotNo) ?? 0) + part));
  }
  const allocated = round3([...byLot.values()].reduce((sum, part) => sum + part, 0));
  if (allocated > round3(quantity)) {
    throw new InventoryError(
      'VALIDATION',
      `Tổng phân bổ theo lô (${allocated}) vượt số lượng (${quantity}).`,
    );
  }
  const parts: { lotNo?: string; quantity: number }[] = [...byLot].map(([lotNo, part]) => ({
    lotNo,
    quantity: part,
  }));
  const rest = round3(quantity - allocated);
  if (rest > 0) parts.push({ quantity: rest });
  return parts;
}
