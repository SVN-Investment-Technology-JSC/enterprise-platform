import type { SocialOrgNode, SocialOrgNodeKind, SocialUnitRef } from '@enterprise-platform/contracts-social';

/**
 * Ngữ cảnh phòng ban của một người, dùng cho quyền xem bài đợt 2 (`visibility`: unit/custom).
 *
 * Luật 4 cấm đọc schema phân hệ khác, nên danh bạ và sơ đồ tổ chức đến từ Tenant Core qua
 * `OrgStructurePort` (cùng endpoint organization context với `HttpOrganizationDirectory`). SQL
 * KHÔNG bao giờ nối vào bảng của Core; chỉ nhận mảng `unitIds` làm tham số (xem `post-visibility-sql.ts`).
 *
 * BE-V hiện thực cả hai cổng (`infrastructure/http-org-structure.ts`); BE-G chỉ dùng
 * `OrgStructurePort` (tạo nhóm theo phòng ban/vị trí) và test bằng bản giả.
 */
export const VIEWER_SCOPE = Symbol('SOCIAL_VIEWER_SCOPE');
export const ORG_STRUCTURE = Symbol('SOCIAL_ORG_STRUCTURE');

export interface ViewerScope {
  readonly userId: string;
  /**
   * Id mọi nút tổ chức mà người này thuộc về, GỒM CẢ các nút cha lên tới gốc: nút được bổ nhiệm
   * (có thể là nút vị trí) cùng mọi tổ tiên. Nhờ đó "phòng ban gồm phòng con" thành phép kiểm
   * thành viên: bài của phòng P (hoặc chọn P làm đối tượng) thấy được bởi người có P trong `unitIds`.
   * Rỗng nếu người chưa thuộc nút nào hoặc không có trong danh bạ.
   */
  readonly unitIds: readonly string[];
}

export interface ViewerScopePort {
  /** Không ném lỗi: không tra được thì `unitIds` rỗng (người đó chỉ thấy bài công khai và bài của mình). */
  scopeOf(tenantId: string, userId: string): Promise<ViewerScope>;

  /** Nhiều người một lần (kiểm người được nhắc tên, người nhận thông báo). Khoá là id viết thường. */
  scopesOf(tenantId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, ViewerScope>>;

  /**
   * Phòng ban của tác giả để ghi vào `posts.author_unit_id` khi chọn quyền `unit`: nút gần nhất KHÔNG
   * phải vị trí, đi lên từ nút được bổ nhiệm. `undefined` nếu chưa thuộc phòng ban nào.
   */
  authorUnitOf(tenantId: string, userId: string): Promise<string | undefined>;
}

/** Nguồn thành viên nhóm / đối tượng chia sẻ cần nở thành người. */
export interface OrgNodeSelection {
  readonly id: string;
  /** Mặc định `true`. */
  readonly includeDescendants?: boolean;
}

export interface OrgStructurePort {
  /** Danh sách nút để chọn; tìm theo tên không phân biệt dấu. `memberCount` gồm nút con. */
  listNodes(
    tenantId: string,
    query: { readonly kind?: SocialOrgNodeKind; readonly query?: string; readonly limit: number },
  ): Promise<readonly SocialOrgNode[]>;

  /** Tên nút theo id; id không có trong sơ đồ thì không có trong kết quả. Khoá là id viết thường. */
  nodeRefs(tenantId: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, SocialUnitRef>>;

  /**
   * Id người đang làm việc thuộc các nút (và nút con nếu `includeDescendants`), không trùng, thứ tự
   * ổn định. Dùng khi tạo nhóm theo phòng ban/vị trí và "đồng bộ lại".
   */
  memberIdsOf(tenantId: string, selections: readonly OrgNodeSelection[]): Promise<readonly string[]>;
}
