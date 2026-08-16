import type {
  CreateMaintenanceAssetRequest,
  CreateMaintenanceJobPlanRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceWorkspace,
  UpdateMaintenanceAssetRequest,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';
import { MaintenanceError } from '../domain/maintenance.error.js';
import type { MaintenanceActor, MaintenanceStore } from './maintenance-store.port.js';

export class MaintenanceApplication {
  constructor(private readonly store: MaintenanceStore) {}

  async workspace(actor: MaintenanceActor): Promise<MaintenanceWorkspace> {
    const state = await this.store.read(actor.tenantId);
    return {
      tenantId: actor.tenantId,
      actor: { id: actor.userId, name: actor.displayName },
      permissions: {
        canManageAssets: actor.canManage,
        canManageJobPlans: actor.canManage,
        canManageSchedules: actor.canManage,
      },
      ...state,
      metrics: {
        activeSchedules: state.schedules.filter((item) => item.status === 'active').length,
        upcomingOccurrences: state.occurrences.filter((item) => item.status === 'planned').length,
        generatedOccurrences: state.occurrences.filter((item) => item.status === 'generated').length,
        completedOccurrences: state.occurrences.filter((item) => item.status === 'completed').length,
      },
    };
  }

  createAsset(actor: MaintenanceActor, input: CreateMaintenanceAssetRequest) {
    this.requireManager(actor);
    if (!input.code?.trim() || !input.name?.trim()) throw new MaintenanceError('validation', 'Mã và tên thiết bị là bắt buộc.');
    return this.store.createAsset(actor.tenantId, input);
  }

  updateAsset(actor: MaintenanceActor, id: string, input: UpdateMaintenanceAssetRequest) {
    this.requireManager(actor);
    return this.store.updateAsset(actor.tenantId, id, input);
  }

  createJobPlan(actor: MaintenanceActor, input: CreateMaintenanceJobPlanRequest) {
    this.requireManager(actor);
    if (!input.code?.trim() || !input.name?.trim()) throw new MaintenanceError('validation', 'Mã và tên job plan là bắt buộc.');
    return this.store.createJobPlan(actor.tenantId, input);
  }

  createSchedule(actor: MaintenanceActor, input: CreateMaintenanceScheduleRequest) {
    this.requireManager(actor);
    if (!input.assetId || !input.jobPlanId || !input.startDate) throw new MaintenanceError('validation', 'Thiết bị, job plan và ngày bắt đầu là bắt buộc.');
    return this.store.createSchedule(actor.tenantId, input);
  }

  updateSchedule(actor: MaintenanceActor, id: string, input: UpdateMaintenanceScheduleRequest) {
    this.requireManager(actor);
    return this.store.updateSchedule(actor.tenantId, id, input);
  }

  generateDueOccurrences(tenantId: string, now = new Date()) {
    return this.store.generateDueOccurrences(tenantId, now);
  }

  private requireManager(actor: MaintenanceActor): void {
    if (!actor.canManage) throw new MaintenanceError('forbidden', 'Bạn không có quyền quản trị bảo trì.');
  }
}
