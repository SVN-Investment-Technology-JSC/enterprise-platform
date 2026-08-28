// Asset and JobPlan types moved to contracts-inventory.
// This module now focuses on scheduling and occurrence management.

/**
 * Năm tần suất dựng sẵn.
 *
 * Đây là giá trị MẶC ĐỊNH, không còn là danh sách đóng: admin thêm/xoá tần suất
 * trong cấu hình module (`catalog.frequency`). Giữ mảng này vì lịch bảo trì đang
 * chạy lưu đúng các mã này, và vì màn hình cần thứ tự hiển thị mặc định.
 */
export const MAINTENANCE_FREQUENCIES = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;

/**
 * Mã tần suất. Là chuỗi tự do chứ không phải union, vì admin định nghĩa thêm
 * được — đóng cứng danh sách trong code sẽ khiến mọi tần suất tự thêm bị coi là
 * sai kiểu. Danh sách hợp lệ nằm trong `catalog.frequency` của cấu hình module.
 */
export type MaintenanceFrequency = string;
export type MaintenanceScheduleStatus = 'draft' | 'active' | 'paused';
export type MaintenancePriority = 'High' | 'Normal' | 'Low';

export interface MaintenanceSchedule {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly assetCode: string;
  readonly procedureDefinitionId?: string;
  readonly procedureDefinitionCode?: string;
  readonly procedureDefinitionName?: string;
  readonly frequency: MaintenanceFrequency;
  readonly priority: MaintenancePriority;
  readonly status: MaintenanceScheduleStatus;
  readonly pausedReason?:
    | 'MANUAL'
    | 'PROCEDURE_ENTITLEMENT_DISABLED'
    | 'PROCEDURE_DEFINITION_UNAVAILABLE';
  readonly startDate: string;
  readonly timezone: string;
  readonly nextDueAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MaintenanceOccurrenceStatus =
  | 'planned'
  | 'in_progress'
  | 'dispatch_pending'
  | 'generated'
  | 'completed'
  | 'failed'
  | 'blocked';

/** Định kỳ do lịch sinh ra; sự cố do người dùng ghi nhận đột xuất. */
export type MaintenanceOccurrenceKind = 'preventive' | 'incident';

export interface MaintenanceOccurrence {
  readonly id: string;
  readonly kind: MaintenanceOccurrenceKind;
  /** Mã hiển thị của sự cố, ví dụ INC-2026-0042. Định kỳ không có. */
  readonly code?: string;
  /** Sự cố không có lịch cha nên hai trường này rỗng. */
  readonly scheduleId?: string;
  readonly scheduleTitle?: string;
  readonly title: string;
  readonly description?: string;
  readonly assetCode: string;
  /** Resolved from Inventory when available; Maintenance only stores assetCode. */
  readonly assetName?: string;
  readonly dueAt: string;
  readonly priority: MaintenancePriority;
  readonly status: MaintenanceOccurrenceStatus;
  readonly procedureInstanceId?: string;
  readonly procedureInstanceCode?: string;
  readonly failureReason?: string;
  readonly idempotencyKey?: string;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
  readonly completionNote?: string;
  readonly completedBy?: string;
  readonly completedByName?: string;
  readonly createdBy?: string;
  readonly createdByName?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface MaintenanceHistoryFilter {
  readonly assetCode?: string;
  readonly kind?: MaintenanceOccurrenceKind;
  readonly status?: MaintenanceOccurrenceStatus;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  /** Con trỏ keyset dạng `<dueAt>|<id>`; ổn định hơn OFFSET khi dữ liệu đang thay đổi. */
  readonly cursor?: string;
}

export interface MaintenanceHistoryPage {
  readonly items: readonly MaintenanceOccurrence[];
  readonly nextCursor?: string;
  readonly stats: {
    readonly total: number;
    readonly completed: number;
    /** Tỷ lệ hoàn thành không trễ hạn, 0–100. */
    readonly onTimeRate: number;
  };
}

export interface CreateMaintenanceIncidentRequest {
  readonly assetCode: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: MaintenancePriority;
  /** Chọn quy trình để tự mở workorder xử lý. Bỏ trống thì chỉ ghi nhận. */
  readonly procedureDefinitionId?: string;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
}

export interface CompleteMaintenanceOccurrenceRequest {
  readonly note?: string;
}

/** Phát từ Procedure khi một hồ sơ kết thúc, dù kết thúc theo cách nào. */
export interface ProcedureInstanceCompletedEventPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly status: 'completed' | 'rejected' | 'cancelled';
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly completedAt?: string;
}

export interface MaintenanceProcedureCatalogEntry {
  readonly definitionId: string;
  readonly code: string;
  readonly name: string;
  readonly versionNumber: number;
  readonly status: 'published' | 'archived';
  readonly synchronizedAt: string;
}

export interface MaintenanceDashboardMetrics {
  readonly activeSchedules: number;
  readonly upcomingOccurrences: number;
  readonly generatedOccurrences: number;
  readonly completedOccurrences: number;
  /** Sự cố chưa xử lý xong — con số cần nổi bật nhất trên dashboard. */
  readonly openIncidents: number;
}

export interface MaintenanceWorkspace {
  readonly tenantId: string;
  readonly actor: { readonly id: string; readonly name: string };
  readonly permissions: {
    readonly canManageSchedules: boolean;
    readonly canManageOccurrences: boolean;
  };
  readonly schedules: readonly MaintenanceSchedule[];
  readonly occurrences: readonly MaintenanceOccurrence[];
  readonly procedureCatalog: readonly MaintenanceProcedureCatalogEntry[];
  readonly metrics: MaintenanceDashboardMetrics;
}

/** Read-only organization data exposed by Maintenance to its own web client. */
export interface MaintenanceOrganizationContext {
  readonly version: number;
  readonly source: string;
  readonly tenantId: string;
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly units: readonly { readonly id: string; readonly name: string }[];
}

export interface CreateMaintenanceScheduleRequest {
  readonly assetCode: string;
  readonly procedureDefinitionId?: string;
  readonly frequency: MaintenanceFrequency;
  readonly priority?: MaintenancePriority;
  readonly startDate: string;
  readonly timezone?: string;
  readonly activate?: boolean;
}

export interface UpdateMaintenanceScheduleRequest {
  readonly status?: MaintenanceScheduleStatus;
  readonly priority?: MaintenancePriority;
  readonly procedureDefinitionId?: string | null;
}

/** Thiết bị lấy từ Kho; Bảo trì chỉ giữ mã, không sao chép cây tài sản. */
export interface MaintenanceMatrixAsset {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly parentCode?: string;
  readonly orgUnitId?: string;
  /**
   * Số đầu việc mặc định đang khai báo trong Kho.
   *
   * `undefined` nghĩa là KHÔNG ĐỌC ĐƯỢC từ Kho, khác hẳn `0` là đọc được và
   * thiết bị thật sự chưa khai báo đầu việc nào. Gộp hai trường hợp này lại thì
   * lúc Kho hỏng, mọi thiết bị đều hiện "0 đầu việc" và người dùng tưởng dữ liệu
   * bị mất.
   */
  readonly taskCount?: number;
}

export interface MaintenanceMatrixCell {
  readonly scheduleId: string;
  readonly status: MaintenanceScheduleStatus;
  readonly nextDueAt?: string;
}

export interface MaintenanceMatrixRow {
  readonly asset: MaintenanceMatrixAsset;
  /** Chu kỳ đang bật; một thiết bị có thể có nhiều chu kỳ cùng lúc. */
  readonly cells: Readonly<Partial<Record<MaintenanceFrequency, MaintenanceMatrixCell>>>;
  readonly procedureDefinitionId?: string;
  readonly priority: MaintenancePriority;
}

export interface MaintenanceMatrix {
  /**
   * Thiết bị trong Kho chưa có mặt trên ma trận, cho ô "Thêm thiết bị".
   *
   * Ma trận là danh sách do người dùng tự chọn chứ không đổ hết Kho: một tenant
   * vài trăm thiết bị mà đổ hết thì bảng không dùng được.
   */
  readonly availableAssets: readonly MaintenanceMatrixAsset[];
  readonly rows: readonly MaintenanceMatrixRow[];
  readonly procedureCatalog: readonly MaintenanceProcedureCatalogEntry[];
  /** Sai khi chưa nối được sang Kho: bảng vẫn hiện nhưng chỉ gồm thiết bị đã có lịch. */
  readonly assetDirectoryAvailable: boolean;
}

export interface SaveMaintenanceMatrixRequest {
  readonly entries: ReadonlyArray<{
    readonly assetCode: string;
    readonly frequencies: readonly MaintenanceFrequency[];
    /**
     * Ngày bảo trì kế tiếp cho từng tần suất, dạng `YYYY-MM-DD`.
     *
     * Thiếu thì server lấy hôm nay. Mặc định "hôm nay" là sai trong hầu hết
     * trường hợp thật: người ta lập ma trận vào tháng 8 cho đợt bảo trì tháng
     * 11, và để mặc định thì phiếu sinh ra ngay hôm lập.
     *
     * Chỉ áp cho lịch MỚI tạo; lịch đang chạy giữ nguyên hạn của nó, nếu không
     * mỗi lần lưu ma trận là mọi lịch bị đẩy về cùng một ngày.
     */
    readonly startDates?: Readonly<Record<string, string>>;
    readonly procedureDefinitionId?: string;
    readonly priority?: MaintenancePriority;
  }>;
}

export interface SaveMaintenanceMatrixResult {
  readonly created: number;
  readonly reactivated: number;
  readonly paused: number;
  readonly updated: number;
}

export const MAINTENANCE_PERMISSIONS = [
  'maintenance.access',
  'maintenance.schedule.view',
  'maintenance.schedule.manage',
  'maintenance.occurrence.view',
  'maintenance.occurrence.manage',
] as const;

export type MaintenancePermission =
  (typeof MAINTENANCE_PERMISSIONS)[number];

export interface ProcedureDefinitionPublishedEventPayload {
  readonly definitionId: string;
  readonly code: string;
  readonly name: string;
  readonly versionNumber: number;
}

export interface ProcedureStartRequestedEventPayload {
  readonly occurrenceId: string;
  readonly scheduleId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly equipment: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  };
}

export interface ProcedureInstanceStartedEventPayload {
  readonly occurrenceId: string;
  readonly scheduleId: string;
  readonly instanceId: string;
  readonly instanceCode: string;
}


// ---------------------------------------------------------------- Cấu hình module

/**
 * Khoá cấu hình của module Bảo trì.
 *
 * Union đóng, cùng lý do với Kho: bảng lưu là khoá–giá trị nên đây là lớp chặn
 * duy nhất giữ nó không trôi thành kho dữ liệu tự do.
 */
export const MAINTENANCE_SETTINGS_KEYS = [
  'dashboard.cards',
  'catalog.frequency',
] as const;

export type MaintenanceSettingsKey = (typeof MAINTENANCE_SETTINGS_KEYS)[number];

/** Danh sách id thẻ dashboard admin đã chọn. Thứ tự trong mảng là thứ tự hiển thị. */
export interface MaintenanceDashboardCardSelection {
  readonly cardIds: readonly string[];
}

/**
 * Một tần suất do admin định nghĩa.
 *
 * `intervalUnit` và `intervalCount` là phần thật sự quan trọng: ngày đến hạn kế
 * tiếp được tính từ hai trường này, nên đổi nhãn không ảnh hưởng lịch còn đổi
 * hai trường này thì có.
 */
export interface MaintenanceFrequencyOption {
  readonly code: string;
  readonly label: string;
  readonly intervalUnit: 'day' | 'week' | 'month' | 'year';
  readonly intervalCount: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface MaintenanceFrequencyCatalog {
  readonly options: readonly MaintenanceFrequencyOption[];
}

export interface MaintenanceSettings {
  readonly 'dashboard.cards': MaintenanceDashboardCardSelection;
  readonly 'catalog.frequency': MaintenanceFrequencyCatalog;
}

export interface MaintenanceSettingsEntry<TValue> {
  readonly key: string;
  readonly value: TValue;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Đọc cả module: mọi khoá đều có mặt, khoá thiếu dòng được điền mặc định. */
export type MaintenanceSettingsSnapshot = {
  readonly [K in MaintenanceSettingsKey]: MaintenanceSettingsEntry<MaintenanceSettings[K]>;
};

export interface UpdateMaintenanceSettingsRequest<TValue> {
  readonly value: TValue;
  /** Version đã đọc; lệch thì trả 409. Bỏ trống là ghi đè bất chấp. */
  readonly expectedVersion?: number;
}
