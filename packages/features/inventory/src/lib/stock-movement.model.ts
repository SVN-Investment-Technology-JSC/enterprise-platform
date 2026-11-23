import {
  STOCK_DOCUMENT_TYPES,
  type StockDocumentType,
  type StockMovementEntry,
  type TransactionType,
} from '@enterprise-platform/contracts-inventory';
import { TRANSACTION_TYPE_LABEL } from './inventory-labels';
import { STOCK_DOCUMENT_TYPE_LABEL, sourceTypeLabel } from './stock-document.model';

/**
 * Logic thuần của tab "Xuất/nhập kho": nhãn, lựa chọn bộ lọc và phân giải link
 * cũ. Không gọi API, không đụng React, để test được độc lập.
 */

/** Ba góc nhìn của tab: danh sách gộp, chứng từ chờ duyệt, yêu cầu xuất từ đơn bán. */
export type MovementView = 'all' | 'pending' | 'requests';

export const MOVEMENT_VIEWS: readonly { id: MovementView; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'pending', label: 'Chờ duyệt' },
  { id: 'requests', label: 'Yêu cầu xuất từ đơn bán' },
];

export interface MovementHashTarget {
  readonly view: MovementView;
  /** Id hoặc số chứng từ cần mở thẳng chi tiết. */
  readonly documentKey?: string;
}

/** Hash của các màn đã gộp vào tab; giữ để link đã chia sẻ và thông báo cũ không vỡ. */
const LEGACY_VIEW: Readonly<Record<string, MovementView>> = {
  documents: 'all',
  vouchers: 'all',
  approvals: 'pending',
  'issue-requests': 'requests',
};

function decode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).trim() || undefined;
  } catch {
    return value.trim() || undefined;
  }
}

/**
 * Hash nào thì mở tab "Xuất/nhập kho", ở góc nhìn nào, có mở sẵn chứng từ không.
 * Nhận cả hash mới (`#stock/movements`, `#stock/movements/<id>`) lẫn hash của ba
 * màn cũ (`#documents`, `#approvals`, `#issue-requests`, `#vouchers/<id>`).
 * Trả `undefined` khi hash không thuộc tab này.
 */
export function movementHashTarget(hash: string): MovementHashTarget | undefined {
  const [head, second, third] = hash.replace(/^#/, '').split('/');
  if (head === 'stock' && second === 'movements') {
    return { view: 'all', documentKey: decode(third) };
  }
  const view = LEGACY_VIEW[head ?? ''];
  if (!view) return undefined;
  // Mở sẵn chứng từ chỉ có nghĩa ở danh sách gộp; hai góc nhìn kia có bàn làm việc riêng.
  return view === 'all' ? { view, documentKey: decode(second) } : { view };
}

/** Nguồn phát sinh hay gặp, cho bộ lọc. Giá trị là mã đã chuẩn hoá của server. */
export const MOVEMENT_SOURCE_CODES = [
  'manual',
  'crm_sales_order',
  'crm_delivery',
  'crm_warranty',
  'crm_return',
  'procedure',
  'maintenance',
  'stocktake',
  'asset',
  'opening_balance',
] as const;

export const MOVEMENT_SOURCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Mọi nguồn' },
  ...MOVEMENT_SOURCE_CODES.map((code) => ({ value: code, label: sourceTypeLabel(code) })),
];

/** Loại của một dòng: nhãn loại chứng từ, hoặc nhãn loại bút toán cho dòng cũ. */
export function movementTypeLabel(entry: Pick<StockMovementEntry, 'kind' | 'type'>): string {
  if (entry.kind === 'document' && (STOCK_DOCUMENT_TYPES as readonly string[]).includes(entry.type)) {
    return STOCK_DOCUMENT_TYPE_LABEL[entry.type as StockDocumentType];
  }
  return TRANSACTION_TYPE_LABEL[entry.type as TransactionType] ?? entry.type;
}

export function movementWarehouseLabel(
  entry: Pick<StockMovementEntry, 'warehouseCode' | 'targetWarehouseCode'>,
): string {
  return entry.targetWarehouseCode ? `${entry.warehouseCode} → ${entry.targetWarehouseCode}` : entry.warehouseCode;
}

/** Mặt hàng hiển thị trên danh sách: mặt hàng đầu, kèm số mặt hàng còn lại nếu có. */
export function movementMaterialLabel(
  entry: Pick<StockMovementEntry, 'materialCode' | 'materialName' | 'lineCount'>,
): string {
  if (!entry.materialCode) return '—';
  const first = entry.materialName ? `${entry.materialCode} - ${entry.materialName}` : entry.materialCode;
  return entry.lineCount > 1 ? `${first} và ${entry.lineCount - 1} dòng khác` : first;
}

/**
 * Lời báo sau lệnh nhập, xuất nhanh (ISS-BE-006): phần đã ghi sổ kèm mã bút toán,
 * phần đã gửi duyệt kèm số chứng từ Chờ duyệt (tồn chưa đổi). Không báo "đã ghi
 * sổ" cho chứng từ chưa được duyệt.
 */
export function movementOutcomeMessage(
  postedText: string,
  transactionCodes: readonly string[],
  pendingDocumentCodes: readonly string[],
): string {
  const parts: string[] = [];
  if (transactionCodes.length > 0) {
    parts.push(`${postedText} — chứng từ [${transactionCodes.join(', ')}]`);
  }
  if (pendingDocumentCodes.length > 0) {
    parts.push(
      `Đã gửi duyệt ${pendingDocumentCodes.length} chứng từ [${pendingDocumentCodes.join(', ')}]; tồn kho chỉ thay đổi sau khi người duyệt duyệt và ghi sổ`,
    );
  }
  return `${parts.join('. ')}.`;
}
