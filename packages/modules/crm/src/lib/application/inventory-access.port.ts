/** Token DI của `InventoryAccessReader`. */
export const INVENTORY_ACCESS_READER = Symbol('CRM_INVENTORY_ACCESS_READER');

/** Kho đối với một người dùng: tenant đã mua Kho chưa, và người này có vào được không. */
export interface InventoryAccess {
  readonly inventoryEntitled: boolean;
  readonly canAccessInventory: boolean;
}

export const NO_INVENTORY_ACCESS: InventoryAccess = { inventoryEntitled: false, canAccessInventory: false };

/**
 * Hỏi Platform về Kho của người dùng. Chỉ phục vụ ẩn hiện nút Kho ở giao diện:
 * quyền thật vẫn do guard của Kho kiểm. Không đọc được thì trả cả hai `false`,
 * không bao giờ ném lỗi.
 */
export interface InventoryAccessReader {
  read(input: { tenantId: string; userId: string; sessionId?: string }): Promise<InventoryAccess>;
}
