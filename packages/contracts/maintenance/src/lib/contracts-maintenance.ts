export const MAINTENANCE_ASSET_TYPES = [
  'company',
  'site',
  'system',
  'equipment',
  'part',
] as const;

export type MaintenanceAssetType = (typeof MAINTENANCE_ASSET_TYPES)[number];
export type MaintenanceAssetStatus = 'active' | 'inactive' | 'retired';
export type MaintenanceAssetHealth =
  | 'unknown'
  | 'good'
  | 'warning'
  | 'critical';

export interface MaintenanceAsset {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: MaintenanceAssetType;
  readonly parentId?: string;
  readonly status: MaintenanceAssetStatus;
  readonly health: MaintenanceAssetHealth;
  readonly location?: string;
  readonly manufacturer?: string;
  readonly organizationUnitId?: string;
  readonly organizationUnitName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MaintenanceChecklistItem {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly required: boolean;
}

export type MaintenanceJobPlanStatus = 'draft' | 'published' | 'archived';

export interface MaintenanceJobPlan {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly status: MaintenanceJobPlanStatus;
  readonly versionNumber: number;
  readonly checklist: readonly MaintenanceChecklistItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt?: string;
}

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

export interface MaintenanceSchedule {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly assetId: string;
  readonly jobPlanId: string;
  readonly procedureDefinitionId?: string;
  readonly procedureDefinitionCode?: string;
  readonly procedureDefinitionName?: string;
  readonly frequency: MaintenanceFrequency;
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
  | 'dispatch_pending'
  | 'generated'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface MaintenanceOccurrence {
  readonly id: string;
  readonly scheduleId: string;
  readonly scheduleTitle: string;
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly dueAt: string;
  readonly status: MaintenanceOccurrenceStatus;
  readonly procedureInstanceId?: string;
  readonly procedureInstanceCode?: string;
  readonly failureReason?: string;
  readonly createdAt: string;
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
}

export interface MaintenanceWorkspace {
  readonly tenantId: string;
  readonly actor: { readonly id: string; readonly name: string };
  readonly permissions: {
    readonly canManageAssets: boolean;
    readonly canManageJobPlans: boolean;
    readonly canManageSchedules: boolean;
  };
  readonly assets: readonly MaintenanceAsset[];
  readonly jobPlans: readonly MaintenanceJobPlan[];
  readonly schedules: readonly MaintenanceSchedule[];
  readonly occurrences: readonly MaintenanceOccurrence[];
  readonly procedureCatalog: readonly MaintenanceProcedureCatalogEntry[];
  readonly metrics: MaintenanceDashboardMetrics;
}

export interface CreateMaintenanceAssetRequest {
  readonly code: string;
  readonly name: string;
  readonly type: MaintenanceAssetType;
  readonly parentId?: string;
  readonly location?: string;
  readonly manufacturer?: string;
  readonly organizationUnitId?: string;
  readonly organizationUnitName?: string;
}

export interface UpdateMaintenanceAssetRequest {
  readonly name?: string;
  readonly status?: MaintenanceAssetStatus;
  readonly health?: MaintenanceAssetHealth;
  readonly location?: string;
  readonly manufacturer?: string;
  readonly organizationUnitId?: string | null;
  readonly organizationUnitName?: string | null;
}

export interface CreateMaintenanceJobPlanRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly publish?: boolean;
  readonly checklist: readonly {
    readonly title: string;
    readonly required?: boolean;
  }[];
}

export interface CreateMaintenanceScheduleRequest {
  readonly assetId: string;
  readonly jobPlanId: string;
  readonly procedureDefinitionId?: string;
  readonly frequency: MaintenanceFrequency;
  readonly startDate: string;
  readonly timezone?: string;
  readonly activate?: boolean;
}

export interface UpdateMaintenanceScheduleRequest {
  readonly status?: MaintenanceScheduleStatus;
  readonly procedureDefinitionId?: string | null;
}

export const MAINTENANCE_PERMISSIONS = [
  'maintenance.access',
  'maintenance.asset.view',
  'maintenance.asset.manage',
  'maintenance.job-plan.view',
  'maintenance.job-plan.manage',
  'maintenance.job-plan.publish',
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

