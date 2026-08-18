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
  | 'dispatch_pending'
  | 'generated'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface MaintenanceOccurrence {
  readonly id: string;
  readonly scheduleId: string;
  readonly scheduleTitle: string;
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
    readonly canManageSchedules: boolean;
    readonly canManageOccurrences: boolean;
  };
  readonly schedules: readonly MaintenanceSchedule[];
  readonly occurrences: readonly MaintenanceOccurrence[];
  readonly procedureCatalog: readonly MaintenanceProcedureCatalogEntry[];
  readonly metrics: MaintenanceDashboardMetrics;
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

