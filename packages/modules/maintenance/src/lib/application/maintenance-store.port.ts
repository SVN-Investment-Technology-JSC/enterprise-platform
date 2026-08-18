import type {
  CreateMaintenanceScheduleRequest,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';

export const MAINTENANCE_STORE = Symbol('MAINTENANCE_STORE');

export interface MaintenanceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly canManage: boolean;
}

export interface MaintenanceSnapshot {
  readonly schedules: MaintenanceSchedule[];
  readonly occurrences: MaintenanceOccurrence[];
  readonly procedureCatalog: MaintenanceProcedureCatalogEntry[];
}

export interface MaintenanceStore {
  read(tenantId: string): Promise<MaintenanceSnapshot>;
  createSchedule(tenantId: string, input: CreateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  updateSchedule(tenantId: string, id: string, input: UpdateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  generateDueOccurrences(tenantId: string, now: Date): Promise<number>;
  /** Retries occurrences stranded in 'dispatch_pending' by a crash mid-dispatch. */
  reconcileStuckDispatches(tenantId: string, now: Date): Promise<number>;
}
