import {
  DEFAULT_PROGRESS_REPORT_COMPLETE_STATUS,
  PROGRESS_REPORT_COMPLETE_STATUSES,
  type ProgressReportCompleteStatus,
} from '@enterprise-platform/contracts-workspace';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Khoá trong `workspace_settings` của cài đặt báo cáo tiến độ (dùng chung cho việc trong dự án và Công việc khác). */
export const PROGRESS_REPORT_KEY = 'progress_report';

/** Cài đặt báo cáo tiến độ công việc của tenant. */
export interface ProgressReportSettings {
  readonly completeStatus: ProgressReportCompleteStatus;
  readonly requireDescription: boolean;
  readonly startsWork: boolean;
}

/** Đọc cài đặt; chưa cấu hình hay giá trị hỏng thì dùng mặc định, không để việc báo tiến độ lỗi theo. */
export async function loadProgressReportSettings(
  store: Pick<WorkspaceStore, 'settings'>,
  tenantId: string,
): Promise<ProgressReportSettings> {
  const value = (await store.settings.get(tenantId, PROGRESS_REPORT_KEY)) as
    | { completeStatus?: unknown; requireDescription?: unknown; startsWork?: unknown }
    | undefined;
  const status = String(value?.completeStatus ?? '');
  return {
    completeStatus: (PROGRESS_REPORT_COMPLETE_STATUSES as readonly string[]).includes(status)
      ? (status as ProgressReportCompleteStatus)
      : DEFAULT_PROGRESS_REPORT_COMPLETE_STATUS,
    requireDescription: value?.requireDescription === true,
    // Mặc định bật: báo tiến độ nghĩa là đã bắt đầu làm.
    startsWork: value?.startsWork !== false,
  };
}
