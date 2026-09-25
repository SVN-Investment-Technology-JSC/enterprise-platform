import { Inject, Injectable } from '@nestjs/common';
import { WORKSPACE_STORE, type WorkspaceStore } from './workspace-store.port.js';

/**
 * Danh tính người gọi, do `WorkspaceAccessGuard` gắn vào request sau khi
 * access-decision của Platform Core trả về.
 *
 * Tầng application KHÔNG tự đọc JWT và KHÔNG tự quyết định quyền nền tảng —
 * nó chỉ nhận kết quả đã được xác minh.
 */
export interface WorkspaceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  /**
   * Người này là quản trị viên của tenant.
   *
   * Đây là cờ override toàn tenant, đọc từ `system_role` trong
   * `principal.roles`. Áp dụng cho mọi màn hình TRỪ nhóm "Công việc của tôi",
   * nơi ai cũng chỉ thấy việc của chính mình.
   */
  readonly isTenantAdmin: boolean;
  readonly canManage: boolean;
  readonly canWriteTasks: boolean;
  readonly canWriteDocuments: boolean;
  /**
   * Được xoá tài liệu và thư mục.
   *
   * Tách hẳn khỏi quyền ghi: soạn và tải tài liệu lên là việc thường ngày, còn
   * dọn kho là thao tác không có đường lùi. Mặc định chỉ quản trị tenant có;
   * người khác phải được Platform cấp `workspace.document.delete`.
   */
  readonly canDeleteDocuments: boolean;
}

/** Trạng thái cài đặt module cho tenant đang đăng nhập. */
export interface WorkspaceStatus {
  readonly tenantId: string;
  readonly schemaExists: boolean;
  readonly tablesReady: boolean;
  /**
   * Quyền của người đang đăng nhập, để giao diện ẩn hiện cho đúng.
   *
   * Chỉ là **gợi ý hiển thị**: mọi lời gọi ghi vẫn bị server kiểm lại. Trang
   * Tài liệu tổng quan gom kho của mọi dự án nên chỉ mở cho người được Platform
   * cấp quyền ghi tài liệu (văn thư, quản trị) — thành viên dự án đã có kho của
   * dự án ngay trong trang Dự án.
   */
  readonly capabilities: {
    readonly isTenantAdmin: boolean;
    readonly canManage: boolean;
    readonly canWriteTasks: boolean;
    readonly canWriteDocuments: boolean;
    readonly canDeleteDocuments: boolean;
  };
}

@Injectable()
export class WorkspaceApplication {
  constructor(@Inject(WORKSPACE_STORE) private readonly store: WorkspaceStore) {}

  /**
   * Trả về mức độ sẵn sàng của module cho tenant hiện tại.
   *
   * Chạy được endpoint này nghĩa là cả chuỗi đã thông: guard xác minh JWT,
   * Platform Core trả access-decision, tenant database được phân giải, và
   * store truy vấn được. Giao diện dùng nó để hiện đúng thông báo thay vì
   * một màn hình trống không rõ lý do.
   */
  async status(actor: WorkspaceActor): Promise<WorkspaceStatus> {
    const status = await this.store.diagnostics.schemaStatus(actor.tenantId);
    return {
      tenantId: actor.tenantId,
      schemaExists: status.schemaExists,
      tablesReady: status.tablesReady,
      capabilities: {
        isTenantAdmin: actor.isTenantAdmin,
        canManage: actor.canManage,
        canWriteTasks: actor.canWriteTasks,
        canWriteDocuments: actor.canWriteDocuments,
        canDeleteDocuments: actor.canDeleteDocuments,
      },
    };
  }
}
