import type {
  CreateMaintenanceIncidentRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceHistoryFilter,
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
  /**
   * Đầu việc bảo trì mặc định của một thiết bị, đọc thẳng từ Kho.
   *
   * Có route riêng ở Bảo trì để người dùng xem tại chỗ thay vì bị đá sang module
   * Kho — nhưng dữ liệu vẫn chỉ có một nguồn, Bảo trì không lưu bản sao nào.
   */
  async getAssetTasks(
    actor: MaintenanceActor,
    assetCode: string,
  ): Promise<{ assetCode: string; assetName?: string; tasks: readonly Record<string, unknown>[] }> {
    if (!this.assets) {
      throw new MaintenanceError('conflict', 'Chưa kết nối được module Kho.');
    }
    const code = assetCode.trim();
    if (!code) throw new MaintenanceError('validation', 'Thiếu mã thiết bị.');

    const directory = await this.assets.listAssets(actor.tenantId);
    const asset = directory.find((candidate) => candidate.code === code);
    if (!asset) {
      throw new MaintenanceError('not_found', `Không tìm thấy thiết bị ${code} trong Kho.`);
    }
    return {
      assetCode: asset.code,
      assetName: asset.name,
      tasks: await this.assets.readTaskTemplate(actor.tenantId, code),
    };
  }

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
    // Body sai hình dạng phải trả 400 với lý do, không phải 500 "Internal server
    // error": người gọi API không đoán được mình gửi thiếu gì.
    // Kiểm trên biến cục bộ để phép thu hẹp kiểu không làm mất kiểu phần tử của
    // `input.entries` ở vòng lặp bên dưới.
    const rows: unknown = input?.entries;
    if (!Array.isArray(rows)) {
      throw new MaintenanceError('validation', 'Thiếu danh sách “entries” trong yêu cầu lưu ma trận.');
    }
    for (const row of rows as { assetCode?: string; frequencies?: unknown }[]) {
      if (!row?.assetCode?.trim()) {
        throw new MaintenanceError('validation', 'Mỗi dòng ma trận phải có mã thiết bị.');
      }
      if (!Array.isArray(row.frequencies)) {
        throw new MaintenanceError(
          'validation',
          `Dòng “${row.assetCode}” thiếu danh sách tần suất.`,
        );
      }
    }

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
        canManageOccurrences: actor.canHandleOccurrences ?? actor.canManage,
      },
      ...state,
      metrics: {
        activeSchedules: state.schedules.filter((item) => item.status === 'active').length,
        upcomingOccurrences: state.occurrences.filter((item) => item.status === 'planned').length,
        generatedOccurrences: state.occurrences.filter((item) => item.status === 'generated').length,
        completedOccurrences: state.occurrences.filter((item) => item.status === 'completed').length,
        openIncidents: state.occurrences.filter(
          (item) => item.kind === 'incident' && item.status !== 'completed',
        ).length,
      },
    };
  }

  readHistory(actor: MaintenanceActor, filter: MaintenanceHistoryFilter) {
    return this.store.readHistory(actor.tenantId, filter);
  }

  async getOccurrence(actor: MaintenanceActor, id: string) {
    const occurrence = await this.store.findOccurrence(actor.tenantId, id);
    if (!occurrence) throw new MaintenanceError('not_found', 'Không tìm thấy phiếu bảo trì.');
    return occurrence;
  }

  async completeOccurrence(actor: MaintenanceActor, id: string, note?: string) {
    this.requireOccurrenceHandler(actor);
    return this.store.completeOccurrence(actor.tenantId, actor, id, note);
  }

  async createIncident(actor: MaintenanceActor, input: CreateMaintenanceIncidentRequest) {
    this.requireOccurrenceHandler(actor);
    const assetCode = input.assetCode?.trim();
    if (!assetCode || !input.title?.trim()) {
      throw new MaintenanceError('validation', 'Mã thiết bị và tiêu đề sự cố là bắt buộc.');
    }

    // Mã thiết bị phải có thật (AC-INC-02). Kho hỏng thì bỏ qua kiểm thay vì chặn
    // ghi nhận sự cố — cùng cách xuống thang mà getMatrix đang dùng. Sự cố lúc 2
    // giờ sáng không nên bị chặn chỉ vì một service khác đang chập chờn.
    if (this.assets) {
      try {
        const known = await this.assets.listAssets(actor.tenantId);
        if (known.length > 0 && !known.some((asset) => asset.code === assetCode)) {
          throw new MaintenanceError('validation', `Không tìm thấy thiết bị “${assetCode}” trong Kho.`);
        }
      } catch (error) {
        if (error instanceof MaintenanceError) throw error;
      }
    }

    return this.store.createIncident(actor.tenantId, actor, { ...input, assetCode });
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

  /** Cổng cho xử lý phiếu — rộng hơn quyền sửa cấu hình. */
  private requireOccurrenceHandler(actor: MaintenanceActor): void {
    if (!(actor.canHandleOccurrences ?? actor.canManage)) {
      throw new MaintenanceError('forbidden', 'Bạn không có quyền xử lý phiếu bảo trì.');
    }
  }

  private requireManager(actor: MaintenanceActor): void {
    if (!actor.canManage) throw new MaintenanceError('forbidden', 'Bạn không có quyền sửa cấu hình bảo trì.');
  }
}
