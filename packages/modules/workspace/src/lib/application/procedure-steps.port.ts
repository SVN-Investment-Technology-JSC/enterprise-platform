import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';

/** Các bước đã lọc của một hồ sơ, đúng hình dạng Workspace trả cho giao diện (chưa có `linked` và `available`). */
export type ProcedureStepsSnapshot = Omit<WorkItemProcedureSteps, 'linked' | 'available'> & {
  readonly instanceId: string;
};

/**
 * Đọc các bước của hồ sơ từ Quy trình (chỉ đọc, bằng service token). `undefined` là Quy trình
 * báo không có hồ sơ này; `'unavailable'` là không hỏi được (mạng, cấu hình, lỗi). Không ném lỗi.
 */
export interface ProcedureStepsReader {
  read(tenantId: string, instanceId: string): Promise<ProcedureStepsSnapshot | undefined | 'unavailable'>;
}
