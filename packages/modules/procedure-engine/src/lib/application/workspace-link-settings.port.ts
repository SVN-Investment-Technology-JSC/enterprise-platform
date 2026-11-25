import type { ProcedureEngineSettings } from './workspace-link-settings.js';

export const WORKSPACE_LINK_SETTINGS = Symbol('WORKSPACE_LINK_SETTINGS');

/**
 * Đọc cài đặt "Công việc gắn quy trình" của tenant từ Workspace (route nội bộ chỉ đọc).
 *
 * Không bao giờ ném lỗi: không đọc được thì trả cài đặt cũ trong cache hoặc mặc định (== hành vi cũ), để thao tác
 * Quy trình không tê liệt khi Workspace tắt. Gọi NGOÀI `store.transaction`, rồi dùng giá trị trong callback.
 */
export interface WorkspaceLinkSettingsReader {
  get(tenantId: string): Promise<ProcedureEngineSettings>;
}
