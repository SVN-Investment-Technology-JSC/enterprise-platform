import type { ReservationShortage } from '@enterprise-platform/contracts-inventory';

export class InventoryError extends Error {
  readonly code: string;
  readonly statusCode: number;
  /** Trường thêm vào thân lỗi trả cho bên gọi, ví dụ danh sách dòng thiếu tồn. */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, InventoryError.prototype);
  }
}

export class WarehouseNotFoundError extends InventoryError {
  constructor(warehouseCode: string) {
    super('WAREHOUSE_NOT_FOUND', `Không tìm thấy kho ${warehouseCode}.`, 404);
  }
}

export class MaterialNotFoundError extends InventoryError {
  constructor(materialCode: string) {
    super('MATERIAL_NOT_FOUND', `Không tìm thấy vật tư ${materialCode}.`, 404);
  }
}

export class AssetNotFoundError extends InventoryError {
  constructor(assetCode: string) {
    super('ASSET_NOT_FOUND', `Không tìm thấy thiết bị ${assetCode}.`, 404);
  }
}

export class InsufficientStockError extends InventoryError {
  constructor(
    materialCode: string,
    requested: number,
    available: number,
    warehouseCode?: string,
  ) {
    // Câu này hiện thẳng trên màn hình thủ kho, nên phải nói được cả ba con số
    // họ cần để xử lý tiếp: kho nào, còn bao nhiêu, đang cần bao nhiêu.
    super(
      'INSUFFICIENT_STOCK',
      `${warehouseCode ? `Kho ${warehouseCode} ` : 'Kho '}chỉ còn ${available} ${materialCode}, không đủ cho ${requested}.`,
      400,
    );
  }
}

export class InvalidReservationError extends InventoryError {
  constructor(message: string) {
    super('INVALID_RESERVATION', message, 400);
  }
}

export class UnknownSettingsKeyError extends InventoryError {
  constructor(key: string) {
    super('UNKNOWN_SETTINGS_KEY', `Khoá cấu hình ${key} không hợp lệ.`, 400);
  }
}

export class SettingsVersionConflictError extends InventoryError {
  constructor(key: string) {
    super(
      'SETTINGS_VERSION_CONFLICT',
      `Cấu hình ${key} đã được người khác sửa; tải lại rồi lưu lại.`,
      409,
    );
  }
}

export class StockDocumentNotFoundError extends InventoryError {
  constructor(key: string) {
    super('STOCK_DOCUMENT_NOT_FOUND', `Không tìm thấy chứng từ kho ${key}.`, 404);
  }
}

/** Chuyển trạng thái không có trong máy trạng thái chứng từ kho (kế hoạch mục 5.6). */
export class InvalidStockDocumentTransitionError extends InventoryError {
  constructor(message: string) {
    super('STOCK_DOCUMENT_INVALID_TRANSITION', message, 409);
  }
}

export class PostedStockDocumentError extends InventoryError {
  constructor() {
    super('STOCK_DOCUMENT_POSTED', 'Chứng từ đã ghi sổ không được sửa.', 409);
  }
}

export class StockDocumentSelfApprovalError extends InventoryError {
  constructor() {
    super('STOCK_DOCUMENT_SELF_APPROVAL', 'Không được tự duyệt chứng từ do mình lập.', 403);
  }
}

/**
 * Xuất vượt tồn khả dụng (tồn thực tế trừ phần đã giữ) khi ghi sổ chứng từ.
 *
 * 409 vì yêu cầu hợp lệ nhưng xung đột với trạng thái tồn hiện tại. Đường API cũ
 * (`/v1/issues`, `/v1/transfers`) đổi lỗi này về `InsufficientStockError` (400)
 * để giữ nguyên hợp đồng với màn Kho.
 */
export class InsufficientAvailableStockError extends InventoryError {
  constructor(
    readonly materialCode: string,
    readonly requested: number,
    readonly available: number,
    readonly warehouseCode: string,
  ) {
    super(
      'INSUFFICIENT_AVAILABLE_STOCK',
      `Không đủ tồn khả dụng: kho ${warehouseCode} chỉ còn ${available} ${materialCode} khả dụng, không đủ cho ${requested}.`,
      409,
    );
    // Lớp cha ép prototype về InventoryError; trả lại để `instanceof` nhận ra lỗi này.
    Object.setPrototypeOf(this, InsufficientAvailableStockError.prototype);
  }
}

/**
 * Giữ hàng thiếu tồn ở ít nhất một dòng (Q4: giữ tất cả hoặc không). Không dòng
 * nào được giữ; `shortages` liệt kê mọi dòng thiếu để bên gọi giảm số lượng hoặc
 * chia đợt giao.
 */
export class ReservationInsufficientStockError extends InventoryError {
  constructor(readonly shortages: readonly ReservationShortage[]) {
    super(
      'RESERVATION_INSUFFICIENT_STOCK',
      `Không đủ tồn khả dụng để giữ hàng: ${shortages
        .map(
          (line) =>
            `${line.materialCode} tại kho ${line.warehouseCode} cần ${line.requested}, còn ${line.available}`,
        )
        .join('; ')}.`,
      409,
      { shortages },
    );
    Object.setPrototypeOf(this, ReservationInsufficientStockError.prototype);
  }
}

/** Cùng khoá chống lặp nhưng nội dung yêu cầu khác lần đầu. */
export class IdempotencyKeyConflictError extends InventoryError {
  constructor(key: string) {
    super(
      'IDEMPOTENCY_KEY_CONFLICT',
      `Khoá chống lặp ${key} đã dùng cho một yêu cầu giữ hàng có nội dung khác.`,
      409,
    );
    Object.setPrototypeOf(this, IdempotencyKeyConflictError.prototype);
  }
}

/** Dòng xuất tham chiếu giữ hàng không dùng được: không có, đã đóng, lệch vật tư hoặc kho, xuất quá phần giữ. */
export class ReservationIssueError extends InventoryError {
  constructor(code: string, message: string, statusCode = 409) {
    super(code, message, statusCode);
    Object.setPrototypeOf(this, ReservationIssueError.prototype);
  }
}

/** Mặt hàng dịch vụ (D6) không có dòng tồn: chứng từ kho, giữ hàng, serial đều từ chối. */
export class ServiceMaterialNotStockedError extends InventoryError {
  constructor(materialCode: string) {
    super(
      'SERVICE_MATERIAL_NOT_STOCKED',
      `Mặt hàng dịch vụ không quản lý tồn (${materialCode}).`,
      400,
      { materialCode },
    );
    Object.setPrototypeOf(this, ServiceMaterialNotStockedError.prototype);
  }
}

/** Cùng khoá chống lặp của API nội bộ tạo chứng từ nhưng nội dung khác lần đầu. */
export class DocumentIdempotencyConflictError extends InventoryError {
  constructor(key: string) {
    super(
      'IDEMPOTENCY_KEY_CONFLICT',
      `Khoá chống lặp ${key} đã dùng cho một yêu cầu có nội dung khác.`,
      409,
    );
    Object.setPrototypeOf(this, DocumentIdempotencyConflictError.prototype);
  }
}

/** Unique `(material_id, upper(btrim(serial_number)))` của migration 0013. */
export const SERIAL_UNIQUE_CONSTRAINT = 'uq_serial_tracking_material_serial';

export class SerialDuplicateError extends InventoryError {
  constructor() {
    super(
      'SERIAL_DUPLICATE',
      'Số serial đã có cho vật tư này (không phân biệt chữ hoa, chữ thường). Kiểm tra lại danh sách serial.',
      409,
    );
  }
}

/**
 * Đổi lỗi Postgres mà người dùng gây ra được thành lỗi nghiệp vụ: trùng serial
 * (23505 trên unique serial) thành 409 SERIAL_DUPLICATE thay vì 500. Lỗi nghiệp vụ
 * trả nguyên; lỗi khác trả null để bên gọi ném lại như cũ.
 */
export function toInventoryError(error: unknown): InventoryError | null {
  if (error instanceof InventoryError) return error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (code === '23505' && constraint === SERIAL_UNIQUE_CONSTRAINT) return new SerialDuplicateError();
  return null;
}
