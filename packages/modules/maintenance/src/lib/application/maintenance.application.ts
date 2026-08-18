import type {
  CreateMaintenanceScheduleRequest,
  MaintenanceWorkspace,
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
        canManageSchedules: actor.canManage,
        canManageOccurrences: actor.canManage,
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

  createSchedule(actor: MaintenanceActor, input: CreateMaintenanceScheduleRequest) {
    this.requireManager(actor);
    if (!input.assetCode?.trim() || !input.startDate) {
      throw new MaintenanceError('validation', 'Mã thiết bị (assetCode) và ngày bắt đầu là bắt buộc.');
    }
    return this.store.createSchedule(actor.tenantId, input);
  }

  updateSchedule(actor: MaintenanceActor, id: string, input: UpdateMaintenanceScheduleRequest) {
    this.requireManager(actor);
    return this.store.updateSchedule(actor.tenantId, id, input);
  }

  async generateDueOccurrences(tenantId: string, now = new Date()) {
    return this.store.generateDueOccurrences(tenantId, now);
  }

  async reconcileStuckDispatches(tenantId: string, now = new Date()) {
    return this.store.reconcileStuckDispatches(tenantId, now);
  }

  private requireManager(actor: MaintenanceActor): void {
    if (!actor.canManage) throw new MaintenanceError('forbidden', 'Bạn không có quyền quản trị bảo trì.');
  }
}
