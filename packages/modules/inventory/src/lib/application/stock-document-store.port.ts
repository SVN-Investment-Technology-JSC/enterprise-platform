import type {
  PostedStockDocument,
  StockDocument,
  StockDocumentLineDirection,
  StockDocumentListQuery,
  StockDocumentPage,
  StockDocumentType,
} from '@enterprise-platform/contracts-inventory';

export const STOCK_DOCUMENT_STORE = Symbol('STOCK_DOCUMENT_STORE');

/** Dòng đã chuẩn hoá: chiều đã suy theo loại chứng từ, số lượng đã kiểm dương. */
export interface StockDocumentLineDraft {
  readonly materialCode: string;
  readonly quantity: number;
  readonly direction: StockDocumentLineDirection;
  readonly unitCost: number;
  /** Dòng xuất trừ vào giữ hàng này; chỉ có ở chứng từ xuất. */
  readonly reservationId?: string;
  readonly note?: string;
}

export interface NewStockDocumentInput {
  readonly docType: StockDocumentType;
  readonly warehouseCode: string;
  readonly targetWarehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly createdBy: string;
  readonly lines: readonly StockDocumentLineDraft[];
}

export interface StockDocumentPatch {
  readonly warehouseCode?: string;
  readonly targetWarehouseCode?: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines?: readonly StockDocumentLineDraft[];
}

/**
 * Việc store làm trên chứng từ đã khoá, do hàm `decide` của service trả về sau
 * khi kiểm máy trạng thái trên bản ghi mới nhất.
 */
export type StockDocumentChange =
  | { readonly kind: 'update'; readonly patch: StockDocumentPatch }
  | {
      readonly kind: 'transition';
      readonly to: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
      readonly actorId: string;
      readonly reason?: string;
    }
  | { readonly kind: 'post'; readonly actorId: string };

export interface StockDocumentStore {
  list(tenantId: string, query: StockDocumentListQuery): Promise<StockDocumentPage>;
  /** Tìm theo id (UUID) hoặc theo mã chứng từ. */
  get(tenantId: string, key: string): Promise<StockDocument | null>;
  /** Tạo chứng từ Nháp. Có `idempotencyKey` đã dùng thì trả chứng từ cũ. */
  create(tenantId: string, input: NewStockDocumentInput): Promise<StockDocument>;
  /**
   * Khoá chứng từ `FOR UPDATE`, gọi `decide` trên bản mới nhất rồi áp thay đổi,
   * tất cả trong một transaction. `decide` ném lỗi thì không gì được ghi.
   */
  change(
    tenantId: string,
    key: string,
    decide: (current: StockDocument) => StockDocumentChange,
  ): Promise<PostedStockDocument>;
  /** Tạo và ghi sổ ngay trong cùng một transaction (đường API cũ, chứng từ một dòng). */
  createAndPost(
    tenantId: string,
    input: NewStockDocumentInput,
    postedBy: string,
  ): Promise<PostedStockDocument>;
  /**
   * Tạo chứng từ đảo của chứng từ gốc và ghi sổ ngay, trong một transaction.
   * `check` chạy trên chứng từ gốc đã khoá.
   */
  reverse(
    tenantId: string,
    key: string,
    actorId: string,
    check: (original: StockDocument) => void,
  ): Promise<PostedStockDocument>;
}
