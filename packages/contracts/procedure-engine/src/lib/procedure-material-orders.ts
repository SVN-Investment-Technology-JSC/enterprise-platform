import type { ProcedureInstance, ProcedureStepMaterial } from './procedure-engine.contracts.js';

/**
 * Đơn vật tư xuất kho của Quy trình cho Kho đọc qua `GET /v1/internal/material-orders`
 * (service token), để mọi thủ kho thấy đủ yêu cầu cấp vật tư dù không có mặt trong hồ sơ.
 *
 * Mỗi mục là một đơn `kind: 'issue'` ghi trên hồ sơ cha (`materialOrders`), kèm trạng
 * thái hồ sơ con mở cho đơn đó. Đơn mua sắm không có ở đây: Kho không cấp từ đơn mua.
 */
export interface ProcedureIssueMaterialOrder {
  /** Mã hồ sơ con của đơn, cũng là mã yêu cầu bên Kho. */
  readonly orderCode: string;
  readonly createdAt: string;
  readonly lines: readonly ProcedureStepMaterial[];
  /** Hồ sơ con; vắng khi hồ sơ con đã bị xoá hoặc không tìm thấy. */
  readonly instanceId?: string;
  readonly instanceTitle?: string;
  /** Trạng thái hồ sơ con; chỉ `completed` (duyệt xong) mới cấp được. */
  readonly instanceStatus?: ProcedureInstance['status'];
  readonly parentInstanceId: string;
  readonly parentCode: string;
  readonly parentTitle: string;
  readonly assetCode?: string;
}

export interface ProcedureIssueMaterialOrdersResponse {
  readonly items: readonly ProcedureIssueMaterialOrder[];
}

/**
 * Sự kiện ghi sổ chứng từ xuất của Kho mà Quy trình nghe (bên phát: `INVENTORY_STOCK_ISSUED_EVENT`
 * trong `contracts-inventory`; Quy trình không được phụ thuộc gói của Kho nên khai lại tên ở đây,
 * giữ đúng chuỗi). Quy trình chỉ dùng chứng từ có nguồn là hồ sơ Quy trình để ghi lời báo đã cấp.
 */
export const PROCEDURE_INVENTORY_STOCK_ISSUED_EVENT = 'inventory.stock.issued';

/** Nguồn chứng từ Kho trỏ tới hồ sơ Quy trình (`PROCEDURE_REQUISITION_SOURCE_TYPE` bên Kho). */
export const PROCEDURE_INVENTORY_SOURCE_TYPE = 'procedure_instance';

/** Phần payload `inventory.stock.issued` mà Quy trình đọc. */
export interface ProcedureInventoryStockIssuedPayload {
  readonly documentId: string;
  readonly documentCode: string;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly warehouseCode: string;
  readonly reversesDocumentId: string | null;
  readonly actorUserId: string | null;
  readonly lines?: readonly { readonly materialCode: string; readonly quantity: number }[];
}
