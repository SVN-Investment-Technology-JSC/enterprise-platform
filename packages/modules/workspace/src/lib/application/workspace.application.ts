import { Inject, Injectable } from '@nestjs/common';
import { ProcedureStartForbiddenError } from '../domain/workspace.error.js';
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
  /**
   * Được xem và thao tác mọi dự án như thành viên có đủ quyền, kể cả dự án mình không tham gia
   * (`workspace.project.admin`). Hẹp hơn `isTenantAdmin`: không kéo theo quyền quản trị danh mục
   * dùng chung hay xoá tài liệu. Vắng thì coi là không có.
   */
  readonly canAdminProjects?: boolean;
  /**
   * Được tạo dự án mới (`workspace.project.create`). Vắng thì coi là không có; quản trị tenant luôn có.
   */
  readonly canCreateProject?: boolean;
  /**
   * Giữ `procedure.instance.create` của module Quy trình: được mở hồ sơ từ công việc "Theo quy trình". Vắng thì
   * coi là không có; quản trị tenant luôn có.
   */
  readonly canStartProcedures?: boolean;
}

/** Người này được tạo dự án mới: quản trị tenant hoặc được cấp `workspace.project.create`. */
export function canCreateProject(actor: WorkspaceActor): boolean {
  return actor.isTenantAdmin || actor.canCreateProject === true;
}

/** Người này được mở hồ sơ Quy trình từ Workspace: quản trị tenant hoặc giữ `procedure.instance.create`. */
export function canStartProcedures(actor: WorkspaceActor): boolean {
  return actor.isTenantAdmin || actor.canStartProcedures === true;
}

/** Như `canStartProcedures` nhưng ném 403 thay vì trả về boolean. */
export function requireProcedureStart(actor: WorkspaceActor): void {
  if (!canStartProcedures(actor)) throw new ProcedureStartForbiddenError();
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
    readonly canAdminProjects: boolean;
    /** Được tạo dự án mới: giao diện ẩn nút "Tạo dự án" khi không có. */
    readonly canCreateProject: boolean;
    /**
     * Tenant bật Bán hàng (D1): khách hàng do Bán hàng quản lý, màn khách hàng
     * Workspace chỉ đọc và form dự án tra khách ở Bán hàng.
     */
    readonly customersManagedByCrm: boolean;
  };
}

@Injectable()
export class WorkspaceApplication {
  constructor(
    @Inject(WORKSPACE_STORE) private readonly store: WorkspaceStore,
    private readonly crmSource?: { enabled(tenantId: string): Promise<boolean> },
  ) {}

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
        canAdminProjects: actor.canAdminProjects === true,
        canCreateProject: canCreateProject(actor),
        customersManagedByCrm: (await this.crmSource?.enabled(actor.tenantId)) === true,
      },
    };
  }
}
