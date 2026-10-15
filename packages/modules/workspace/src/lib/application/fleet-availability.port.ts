import type { FleetAvailabilityView, TransportSourceType } from '@enterprise-platform/contracts-workspace';

/** Token Symbol: port HTTP chỉ đọc sang HRM (xem `EXTERNAL_REFERENCE_READER`). */
export const FLEET_AVAILABILITY_READER = Symbol('FLEET_AVAILABILITY_READER');

/**
 * Xe và tài xế còn trống kèm khoảng bận, do HRM (chủ của Lịch xe) trả lời. Workspace không ghi lịch xe:
 * đặt xe đi bằng sự kiện, đọc lịch bận đi bằng port này để form không cho chọn trùng.
 */
export interface FleetAvailabilityReader {
  read(
    tenantId: string,
    query: {
      readonly from: string;
      readonly to: string;
      /** Lịch của chính nguồn đang sửa không tính là bận. */
      readonly exclude?: { readonly sourceType: TransportSourceType; readonly sourceId: string };
    },
  ): Promise<FleetAvailabilityView>;
}
