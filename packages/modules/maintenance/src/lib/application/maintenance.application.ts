import type {
  CreateMaintenanceScheduleRequest,
  MaintenanceFrequency,
  MaintenanceMatrix,
  MaintenanceMatrixAsset,
  MaintenanceMatrixRow,
  MaintenanceWorkspace,
  SaveMaintenanceMatrixRequest,
  SaveMaintenanceMatrixResult,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';
import { MaintenanceError } from '../domain/maintenance.error.js';
import type { AssetDirectory } from './asset-directory.port.js';
import type { MaintenanceActor, MaintenanceStore } from './maintenance-store.port.js';

export class MaintenanceApplication {
  constructor(
    private readonly store: MaintenanceStore,
    private readonly assets?: AssetDirectory,
  ) {}

  /**
   * Ma trận bảo trì: hàng là thiết bị (lấy từ Kho), cột là chu kỳ. Một thiết bị
   * có thể bật nhiều chu kỳ cùng lúc, mỗi chu kỳ là một lịch riêng.
   */
  async getMatrix(actor: MaintenanceActor): Promise<MaintenanceMatrix> {
    const state = await this.store.read(actor.tenantId);

    let directory: MaintenanceMatrixAsset[] = [];
    let available = false;
    if (this.assets) {
      try {
        directory = await this.assets.listAssets(actor.tenantId);
        available = true;
      } catch {
        // Kho không sẵn sàng vẫn phải xem được cấu hình đang có, nên chỉ hạ cờ
        // rồi dựng bảng từ chính các lịch đã lưu.
        available = false;
      }
    }

    const byCode = new Map(directory.map((asset) => [asset.code, asset]));
    for (const schedule of state.schedules) {
      if (byCode.has(schedule.assetCode)) continue;
      byCode.set(schedule.assetCode, {
        code: schedule.assetCode,
        name: schedule.assetCode,
        type: 'UNKNOWN',
        taskCount: 0,
      });
    }

    const rows: MaintenanceMatrixRow[] = [...byCode.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      .map((asset) => {
        const own = state.schedules.filter((schedule) => schedule.assetCode === asset.code);
        const cells: Partial<Record<MaintenanceFrequency, MaintenanceMatrixRow['cells'][MaintenanceFrequency]>> = {};
        for (const schedule of own) {
          if (schedule.status === 'paused') continue;
          cells[schedule.frequency] = {
            scheduleId: schedule.id,
            status: schedule.status,
            nextDueAt: schedule.nextDueAt,
          };
        }
        return {
          asset,
          cells,
          procedureDefinitionId: own.find((schedule) => schedule.procedureDefinitionId)
            ?.procedureDefinitionId,
          priority: own[0]?.priority ?? 'Normal',
        };
      });

    return {
      rows,
      procedureCatalog: state.procedureCatalog,
      assetDirectoryAvailable: available,
    };
  }

  /**
   * Lưu cả bảng một lần. Bỏ tick không xoá lịch mà chuyển sang 'paused': lịch đã
   * sinh phiếu công việc, xoá đi sẽ làm mồ côi các phiếu đó.
   */
  async saveMatrix(
    actor: MaintenanceActor,
    input: SaveMaintenanceMatrixRequest,
  ): Promise<SaveMaintenanceMatrixResult> {
    this.requireManager(actor);
    const state = await this.store.read(actor.tenantId);
    const today = new Date().toISOString().slice(0, 10);
    const result = { created: 0, reactivated: 0, paused: 0, updated: 0 };

    for (const entry of input.entries) {
      const wanted = new Set(entry.frequencies);
      const existing = state.schedules.filter(
        (schedule) => schedule.assetCode === entry.assetCode,
      );

      for (const frequency of wanted) {
        const match = existing.find((schedule) => schedule.frequency === frequency);
        if (!match) {
          await this.store.createSchedule(actor.tenantId, {
            assetCode: entry.assetCode,
            procedureDefinitionId: entry.procedureDefinitionId,
            frequency,
            priority: entry.priority ?? 'Normal',
            startDate: today,
            activate: true,
          });
          result.created += 1;
          continue;
        }

        const patch: { -readonly [K in keyof UpdateMaintenanceScheduleRequest]: UpdateMaintenanceScheduleRequest[K] } = {};
        if (match.status !== 'active') patch.status = 'active';
        if ((match.procedureDefinitionId ?? undefined) !== entry.procedureDefinitionId) {
          patch.procedureDefinitionId = entry.procedureDefinitionId ?? null;
        }
        if (entry.priority && match.priority !== entry.priority) patch.priority = entry.priority;
        if (Object.keys(patch).length === 0) continue;

        await this.store.updateSchedule(actor.tenantId, match.id, patch);
        if (patch.status === 'active') result.reactivated += 1;
        else result.updated += 1;
      }

      for (const schedule of existing) {
        if (wanted.has(schedule.frequency) || schedule.status === 'paused') continue;
        await this.store.updateSchedule(actor.tenantId, schedule.id, { status: 'paused' });
        result.paused += 1;
      }
    }

    return result;
  }

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
