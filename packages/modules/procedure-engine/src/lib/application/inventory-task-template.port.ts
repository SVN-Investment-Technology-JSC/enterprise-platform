export const INVENTORY_TASK_TEMPLATE_RESOLVER = Symbol('INVENTORY_TASK_TEMPLATE_RESOLVER');

/**
 * Reads Role E task lists from the Inventory module.
 *
 * Called only when publishing a definition: the result is frozen into
 * raci_assignments.e_task_config so a published version keeps running the same
 * task list even if the source asset changes afterwards.
 */
export interface InventoryTaskTemplateResolver {
  resolveAssetTaskTemplate(
    tenantId: string,
    assetCode: string,
  ): Promise<Record<string, unknown>[] | null>;

  /**
   * Tên và đơn vị của một vật tư, đọc **lúc công bố** để đóng băng vào bước.
   * Trả `null` khi mã không tồn tại — công bố sẽ bị chặn.
   */
  resolveMaterial(
    tenantId: string,
    materialCode: string,
  ): Promise<{ name: string; unit: string } | null>;

  /**
   * Tồn khả dụng hiện tại, đọc **lúc chạy** và không bao giờ đóng băng: đây
   * chính là con số cần tươi mới nhất.
   */
  readAvailability(tenantId: string, materialCode: string): Promise<number>;

  /**
   * Giữ chỗ vật tư cho một bước. Trả mã phiếu để về sau nhả đúng phiếu đó.
   *
   * Giữ theo **một kho**: bảng `reservations` gắn phiếu với một kho, nên mỗi kho
   * là một phiếu riêng.
   */
  reserveMaterials(
    tenantId: string,
    input: {
      warehouseCode: string;
      referenceId: string;
      items: { materialCode: string; quantityReserved: number }[];
    },
  ): Promise<string>;

  /** Nhả một phiếu giữ chỗ. Idempotent ở phía Kho. */
  releaseReservation(tenantId: string, reservationCode: string): Promise<void>;

  /** Tồn khả dụng theo từng kho, để chọn kho giữ chỗ. */
  readAvailabilityByWarehouse(
    tenantId: string,
    materialCode: string,
  ): Promise<{ warehouseCode: string; available: number }[]>;
}
