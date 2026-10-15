import type {
  CreateMaintenanceIncidentRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceHistoryFilter,
  MaintenanceHistoryPage,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
  MaintenanceSettingsEntry,
  MaintenanceTransport,
  MaintenanceTransportMode,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';

export const MAINTENANCE_STORE = Symbol('MAINTENANCE_STORE');

/** Lựa chọn phương tiện của phiếu sự cố đã kiểm tra, sẵn sàng ghi. Xe công ty có đủ xe, tài xế và khung giờ. */
export interface SaveIncidentTransport {
  readonly incidentId: string;
  readonly sourceLabel: string;
  readonly requesterUserId: string;
  readonly mode: MaintenanceTransportMode;
  readonly detail?: string | null;
  readonly vehicleId?: string;
  readonly driverId?: string;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly destination?: string | null;
}

/**
 * Phương tiện của phiếu sự cố. Xe công ty chỉ được GIỮ ở HRM: lựa chọn và sự kiện `maintenance.fleet-booking.*`
 * được ghi trong cùng một transaction, HRM trả lời `confirmed` hoặc `conflicted`.
 */
export interface IncidentTransportStore {
  find(tenantId: string, incidentId: string): Promise<MaintenanceTransport | undefined>;
  /** Ghi lựa chọn mới; không đổi gì so với bản đang giữ thì không phát lại sự kiện. */
  save(tenantId: string, input: SaveIncidentTransport): Promise<MaintenanceTransport>;
  /** Bỏ phương tiện của phiếu; đang giữ xe thì trả xe. */
  clear(tenantId: string, incidentId: string): Promise<void>;
}

export interface MaintenanceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  /** Sửa cấu hình: lịch bảo trì, ma trận, chạy scheduler. */
  readonly canManage: boolean;
  /**
   * Xử lý phiếu: tạo sự cố, đánh dấu hoàn thành.
   *
   * Tách khỏi `canManage` để kỹ thuật viên làm được việc hằng ngày mà không sửa
   * được lịch của cả công ty (AC-HST-05, AC-INC-01). Bỏ trống = suy theo
   * `canManage`, giữ nguyên hành vi cũ cho nơi gọi chưa cập nhật.
   */
  readonly canHandleOccurrences?: boolean;
}

export interface MaintenanceSnapshot {
  readonly schedules: MaintenanceSchedule[];
  readonly occurrences: MaintenanceOccurrence[];
  readonly procedureCatalog: MaintenanceProcedureCatalogEntry[];
}

export interface MaintenanceStore {
  readonly fleetTransport: IncidentTransportStore;
  read(tenantId: string): Promise<MaintenanceSnapshot>;

  /**
   * Lịch sử bảo trì có lọc và phân trang.
   *
   * Tách khỏi `read()` một cách có chủ ý: `read()` nạp toàn bộ occurrence không
   * giới hạn và đang bị 5 endpoint khác dùng chung, nên không thể gắn WHERE/LIMIT
   * vào đó mà không ảnh hưởng tất cả.
   */
  readHistory(tenantId: string, filter: MaintenanceHistoryFilter): Promise<MaintenanceHistoryPage>;
  findOccurrence(tenantId: string, id: string): Promise<MaintenanceOccurrence | undefined>;
  createIncident(
    tenantId: string,
    actor: MaintenanceActor,
    input: CreateMaintenanceIncidentRequest,
  ): Promise<MaintenanceOccurrence>;
  completeOccurrence(
    tenantId: string,
    actor: MaintenanceActor,
    id: string,
    note?: string,
  ): Promise<MaintenanceOccurrence>;
  createSchedule(tenantId: string, input: CreateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  updateSchedule(tenantId: string, id: string, input: UpdateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  generateDueOccurrences(tenantId: string, now: Date): Promise<number>;
  /** Retries occurrences stranded in 'dispatch_pending' by a crash mid-dispatch. */
  reconcileStuckDispatches(tenantId: string, now: Date): Promise<number>;
  /** Xoá mọi lịch của một thiết bị, kèm phiếu đã sinh ra từ chúng. Trả về số lịch đã xoá. */
  removeSchedulesForAsset(tenantId: string, assetCode: string): Promise<number>;
  /** Đẩy hạn của các lịch đang chạy của một thiết bị về hiện tại. Trả về số lịch bị đẩy. */
  markSchedulesDueNow(tenantId: string, assetCode: string, frequency?: string): Promise<number>;
  /**
   * Bỏ qua đúng một lần bảo trì: đẩy hạn sang chu kỳ kế, không sinh phiếu.
   * Khác `updateSchedule(status:'paused')` ở chỗ lịch vẫn chạy tiếp.
   */
  skipNextOccurrence(tenantId: string, scheduleId: string): Promise<MaintenanceSchedule>;
  listSettings(tenantId: string): Promise<MaintenanceSettingsEntry<unknown>[]>;
  /**
   * Upsert kèm kiểm tra version. Trả `undefined` khi dòng đã tồn tại mà
   * `expectedVersion` không khớp — bên gọi biến nó thành 409 thay vì ghi đè im
   * lặng lên thay đổi của người khác.
   */
  putSetting(
    tenantId: string,
    key: string,
    value: unknown,
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<MaintenanceSettingsEntry<unknown> | undefined>;
}
