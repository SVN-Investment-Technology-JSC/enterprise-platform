import type {
  PostedStockDocument,
  StockDocument,
  StockDocumentLineDirection,
  StockDocumentListQuery,
  StockDocumentLotInput,
  StockDocumentPage,
  StockDocumentType,
  QualityStatus,
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
  /** Serial đã bỏ khoảng trắng, không lặp, đúng bằng số lượng. */
  readonly serials?: readonly string[];
  /** Lô đã chuẩn hoá: số lô viết hoa; dòng xuất chỉ có số lô. */
  readonly lot?: StockDocumentLotInput;
  /**
   * Chỉ khi dòng nhập tạo lô MỚI: trạng thái chất lượng của lô (nhập trả vào kho
   * cách ly tạo lô Chờ kiểm định). Lô đã có thì giữ trạng thái của nó.
   */
  readonly newLotQuality?: QualityStatus;
  /** Số lô gốc để chép ngày sản xuất, hạn dùng, nhà cung cấp sang lô mới. */
  readonly copyLotFrom?: string;
  /** Dòng nhập trả: id dòng xuất gốc để lấy giá vốn. */
  readonly sourceLineId?: string;
  readonly note?: string;
}

export interface NewStockDocumentInput {
  readonly docType: StockDocumentType;
  readonly warehouseCode: string;
  readonly targetWarehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
  /**
   * Dấu nội dung yêu cầu của API nội bộ. Có thì gọi lại cùng khoá mà khác dấu bị
   * 409; không có (màn Kho, đường cũ) thì cùng khoá trả chứng từ cũ như trước.
   */
  readonly requestHash?: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly createdBy: string;
  readonly lines: readonly StockDocumentLineDraft[];
}

/** Tuỳ chọn khi ghi sổ ngay lúc tạo. */
export interface PostOptions {
  /**
   * Trạng thái chất lượng của hàng nhận vào (serial nhập); nhập trả qua API nội
   * bộ dùng Chờ kiểm định để hàng không tính vào khả dụng.
   */
  readonly inboundQuality?: QualityStatus;
  /**
   * Nhập lại hàng đã xuất ra hiện trường (tháo khỏi thiết bị, thanh lý về kho):
   * bút toán nhập ghi loại RETURN và lịch sử serial ghi RETURN như đường cũ.
   */
  readonly returnToStock?: boolean;
  /**
   * Dòng xuất của mặt hàng theo serial mà chưa ghi serial: tự chọn đủ số serial
   * Trong kho, Đạt tại kho xuất (serial nhập trước, rồi theo số serial), khoá
   * FOR UPDATE trong cùng transaction ghi sổ. Không đủ thì 400 SERIALS_REQUIRED.
   * Dùng cho đường lắp cũ không gửi serial.
   */
  readonly autoPickSerials?: boolean;
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
    options?: PostOptions,
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
