/**
 * Sự kiện đặt xe công ty giữa Workspace, Maintenance và HRM.
 *
 * Lịch xe nằm ở HRM; module khác chỉ xem lịch bận qua API chỉ đọc của HRM và đặt xe bằng sự kiện:
 * 1. Công việc, lịch họp hoặc sự cố chọn xe và tài xế còn trống → phát `*.fleet-booking.requested`.
 * 2. HRM kiểm tra trùng lịch lần cuối rồi tạo lịch → trả lời `hrm.fleet-booking.confirmed`, hoặc
 *    `hrm.fleet-booking.conflicted` khi có người đặt trước trong lúc đó.
 * 3. Bỏ chọn xe, huỷ hoặc xoá nguồn → phát `*.fleet-booking.cancelled`, HRM giải phóng lịch.
 */
export type FleetBookingSourceType = 'WORK_ITEM' | 'CALENDAR_EVENT' | 'INCIDENT';

export const WORKSPACE_FLEET_BOOKING_REQUESTED = 'workspace.fleet-booking.requested';
export const WORKSPACE_FLEET_BOOKING_CANCELLED = 'workspace.fleet-booking.cancelled';
export const MAINTENANCE_FLEET_BOOKING_REQUESTED = 'maintenance.fleet-booking.requested';
export const MAINTENANCE_FLEET_BOOKING_CANCELLED = 'maintenance.fleet-booking.cancelled';
export const HRM_FLEET_BOOKING_CONFIRMED = 'hrm.fleet-booking.confirmed';
export const HRM_FLEET_BOOKING_CONFLICTED = 'hrm.fleet-booking.conflicted';

/** Sự kiện HRM lắng nghe từ Workspace và Maintenance. */
export const HRM_FLEET_BOOKING_INBOUND = [
  WORKSPACE_FLEET_BOOKING_REQUESTED,
  WORKSPACE_FLEET_BOOKING_CANCELLED,
  MAINTENANCE_FLEET_BOOKING_REQUESTED,
  MAINTENANCE_FLEET_BOOKING_CANCELLED,
] as const;

/** Sự kiện trả lời của HRM; module nào là chủ của `sourceType` thì nhận, module khác bỏ qua. */
export const FLEET_BOOKING_RESULT_EVENTS = [
  HRM_FLEET_BOOKING_CONFIRMED,
  HRM_FLEET_BOOKING_CONFLICTED,
] as const;

export interface FleetBookingRequestedPayload {
  readonly sourceType: FleetBookingSourceType;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly destination?: string | null;
  readonly requesterUserId?: string | null;
}

export interface FleetBookingCancelledPayload {
  readonly sourceType: FleetBookingSourceType;
  readonly sourceId: string;
}

export interface FleetBookingResultPayload {
  readonly sourceType: FleetBookingSourceType;
  readonly sourceId: string;
  /** Có khi `confirmed`. */
  readonly bookingId?: string;
  /** Có khi `conflicted`: lý do đọc được cho người dùng. */
  readonly reason?: string;
}

/** Phần của một nguồn nằm ở module gửi: trạng thái xe lấy từ trả lời của HRM. */
export type FleetTransportStatus = 'NONE' | 'REQUESTED' | 'CONFIRMED' | 'CONFLICT';
