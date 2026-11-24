import {
  DEFAULT_PROCEDURE_LINK_SETTINGS,
  PROCEDURE_LINK_OPTIONS,
  type ProcedureLinkSettings,
} from '@enterprise-platform/contracts-workspace';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Khoá trong `workspace_settings` của cài đặt liên kết công việc với hồ sơ Quy trình. */
export const PROCEDURE_LINK_KEY = 'procedure_link';

const FIELDS = Object.keys(PROCEDURE_LINK_OPTIONS) as (keyof ProcedureLinkSettings)[];

/** Nhãn tiếng Việt của từng trường, dùng trong thông báo lỗi khi lưu. */
export const PROCEDURE_LINK_FIELD_LABELS: Readonly<Record<keyof ProcedureLinkSettings, string>> = {
  onCompletedWorkItem: 'Khi hồ sơ hoàn tất (công việc trong dự án)',
  completedGuards: 'Ràng buộc khi tự hoàn tất công việc',
  onCompletedStandalone: 'Khi hồ sơ hoàn tất (Công việc khác)',
  onRejected: 'Khi hồ sơ bị từ chối',
  onCancelled: 'Khi hồ sơ bị huỷ',
  onReversed: 'Khi hồ sơ bị huỷ hiệu lực',
  onInstanceDeleted: 'Khi hồ sơ bị xoá',
  onStarted: 'Khi hồ sơ bắt đầu chạy',
  progressPull: 'Lấy tiến độ từ hồ sơ',
  progressPullClosedItems: 'Lấy tiến độ cho công việc đã đóng',
  progressPullDirection: 'Chiều cập nhật tiến độ từ hồ sơ',
  manualProgressWhenLinked: 'Nhập tay tiến độ khi có hồ sơ',
  startProcedureStatusGate: 'Trạng thái cho phép tạo hồ sơ',
  changeProcedureStatusGate: 'Trạng thái cho phép đổi hồ sơ',
};

/** Giá trị lưu hỏng hay thiếu từng trường thì dùng mặc định của trường đó. */
export function normalizeProcedureLinkSettings(value: unknown): ProcedureLinkSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: Record<string, string> = { ...DEFAULT_PROCEDURE_LINK_SETTINGS };
  for (const field of FIELDS) {
    const candidate = raw[field];
    if (typeof candidate === 'string' && PROCEDURE_LINK_OPTIONS[field].includes(candidate)) {
      result[field] = candidate;
    }
  }
  return result as unknown as ProcedureLinkSettings;
}

/** Đọc cài đặt của tenant; chưa cấu hình hay hỏng thì dùng mặc định, không để việc xử lý sự kiện lỗi theo. */
export async function loadProcedureLinkSettings(
  store: Pick<WorkspaceStore, 'settings'>,
  tenantId: string,
): Promise<ProcedureLinkSettings> {
  return normalizeProcedureLinkSettings(await store.settings.get(tenantId, PROCEDURE_LINK_KEY));
}
