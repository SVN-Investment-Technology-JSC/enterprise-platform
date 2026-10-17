/**
 * Danh tính người gọi, do `SharedAccessGuard` gắn vào request sau khi
 * access-decision của Platform trả về. Tầng application không tự đọc JWT.
 */
export interface SharedActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  /** Quản trị viên tenant: vượt mọi hàng rào của phân hệ. */
  readonly isTenantAdmin: boolean;
  /**
   * `shared.manage` (quản trị kho): thấy cả kho dù chưa ai chia sẻ, dựng cây
   * thư mục gốc, chuyển thư mục, gỡ khoá hộ, chia sẻ mọi thư mục.
   */
  readonly canManage: boolean;
  /**
   * `shared.document.write`: tải lên, sửa thông tin, phiên bản mới — ở những
   * thư mục người này có quyền Sửa (xem `folder-access.ts`).
   */
  readonly canWriteDocuments: boolean;
  /**
   * `shared.document.delete`: lưu trữ, xoá tài liệu và thư mục (vào Thùng rác),
   * khôi phục. Xoá vĩnh viễn cần thêm `canManage`.
   *
   * Tách khỏi quyền ghi như Workspace: dọn kho là thao tác khó đảo ngược.
   */
  readonly canDeleteDocuments: boolean;
}

export function isSharedManager(actor: SharedActor): boolean {
  return actor.isTenantAdmin || actor.canManage;
}
