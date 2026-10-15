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
  /** `shared.manage`: dựng cây thư mục gốc, chuyển thư mục, gỡ khoá hộ. */
  readonly canManage: boolean;
  /** `shared.document.write`: tải lên, sửa thông tin, phiên bản mới. */
  readonly canWriteDocuments: boolean;
  /**
   * `shared.document.delete`: lưu trữ tài liệu, xoá thư mục rỗng.
   *
   * Tách khỏi quyền ghi như Workspace: dọn kho là thao tác không có đường lùi.
   */
  readonly canDeleteDocuments: boolean;
}

export function isSharedManager(actor: SharedActor): boolean {
  return actor.isTenantAdmin || actor.canManage;
}
