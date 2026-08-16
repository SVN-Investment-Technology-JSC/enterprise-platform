import type {
  CreateMaintenanceAssetRequest,
  CreateMaintenanceJobPlanRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceAsset,
  MaintenanceJobPlan,
  MaintenanceOccurrence,
  MaintenanceProcedureCatalogEntry,
  MaintenanceSchedule,
  UpdateMaintenanceAssetRequest,
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
  readonly assets: MaintenanceAsset[];
  readonly jobPlans: MaintenanceJobPlan[];
  readonly schedules: MaintenanceSchedule[];
  readonly occurrences: MaintenanceOccurrence[];
  readonly procedureCatalog: MaintenanceProcedureCatalogEntry[];
}

export interface MaintenanceStore {
  read(tenantId: string): Promise<MaintenanceSnapshot>;
  createAsset(tenantId: string, input: CreateMaintenanceAssetRequest): Promise<MaintenanceAsset>;
  updateAsset(tenantId: string, id: string, input: UpdateMaintenanceAssetRequest): Promise<MaintenanceAsset>;
  createJobPlan(tenantId: string, input: CreateMaintenanceJobPlanRequest): Promise<MaintenanceJobPlan>;
  createSchedule(tenantId: string, input: CreateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  updateSchedule(tenantId: string, id: string, input: UpdateMaintenanceScheduleRequest): Promise<MaintenanceSchedule>;
  generateDueOccurrences(tenantId: string, now: Date): Promise<number>;
}
