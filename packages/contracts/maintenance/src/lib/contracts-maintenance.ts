// Asset and JobPlan types moved to contracts-inventory.
// This module now focuses on scheduling and occurrence management.

export const MAINTENANCE_FREQUENCIES = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;

export type MaintenanceFrequency =
  (typeof MAINTENANCE_FREQUENCIES)[number];
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
  /** Số đầu việc mặc định đang khai báo trong Kho. */
  readonly taskCount: number;
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
  readonly rows: readonly MaintenanceMatrixRow[];
  readonly procedureCatalog: readonly MaintenanceProcedureCatalogEntry[];
  /** Sai khi chưa nối được sang Kho: bảng vẫn hiện nhưng chỉ gồm thiết bị đã có lịch. */
  readonly assetDirectoryAvailable: boolean;
}

export interface SaveMaintenanceMatrixRequest {
  readonly entries: ReadonlyArray<{
    readonly assetCode: string;
    readonly frequencies: readonly MaintenanceFrequency[];
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

