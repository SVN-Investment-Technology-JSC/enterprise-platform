import type {
  SocialGroupColor,
  SocialGroupCoverPreset,
  SocialGroupIcon,
  SocialGroupListScope,
  SocialGroupMembershipMode,
  SocialGroupPostPermission,
  SocialGroupPrivacy,
  SocialGroupRole,
  SocialJoinRequestStatus,
  SocialOrgNodeKind,
} from '@enterprise-platform/contracts-social';

/** Token DI của store nhóm. */
export const SOCIAL_GROUP_STORE = Symbol('SOCIAL_GROUP_STORE');

/** Sự kiện của nhóm; store ghi vào outbox cùng transaction với thay đổi dữ liệu (skill erp-events). */
export interface GroupOutboxEvent {
  readonly type: string;
  readonly aggregateType: 'social-group' | 'social-report';
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Thời điểm là chuỗi ISO UTC giữ micro giây của Postgres (cần cho con trỏ phân trang). */
export interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
  readonly createdBy: string;
  readonly createdAt: string;
  /** Đã xoá mềm. `list` không bao giờ trả nhóm đã xoá; `find` thì có. */
  readonly deleted: boolean;
  readonly memberCount: number;
  readonly adminCount: number;
  /** Yêu cầu tham gia đang chờ của mọi người. */
  readonly pendingRequestCount: number;
  /** Của người xem (khi có `viewerId`). */
  readonly myRole?: SocialGroupRole;
  readonly myJoinedAt?: string;
  readonly myPendingRequestId?: string;
  /* Đợt 2. */
  /** HTML đã làm sạch; `description` là bản chữ thuần của nó. */
  readonly descriptionHtml?: string;
  readonly coverPreset?: SocialGroupCoverPreset;
  readonly postPermission: SocialGroupPostPermission;
  readonly membershipMode: SocialGroupMembershipMode;
  readonly lastSyncedAt?: string;
  /** Của người xem: thời điểm ưu tiên nhóm lên trên. */
  readonly myPriorityAt?: string;
  /** Của người xem: có trong danh sách được chọn đăng bài. */
  readonly myPostPermitted: boolean;
}

export interface GroupListRead {
  readonly viewerId: string;
  readonly scope: SocialGroupListScope;
  /** Quản trị toàn hệ thống: `scope = 'all'` gồm cả nhóm riêng tư chưa tham gia. */
  readonly seesAllGroups: boolean;
  readonly query?: string;
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

/** Cách một thành viên vào nhóm (`group_members.added_via`). */
export type GroupMemberAddedVia = 'manual' | 'join' | 'sync' | 'creator';

export interface GroupSourceInsert {
  readonly type: SocialOrgNodeKind;
  readonly sourceId: string;
  /** Tên nút tại lúc lưu. */
  readonly name: string;
  readonly includeDescendants: boolean;
}

export interface GroupInsert {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly descriptionHtml?: string;
  readonly coverPreset?: SocialGroupCoverPreset;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
  readonly createdBy: string;
  readonly postPermission: SocialGroupPostPermission;
  readonly membershipMode: SocialGroupMembershipMode;
  /** Quản lý thêm (vai trò `admin`, `added_via = manual`), không gồm người tạo. */
  readonly adminUserIds: readonly string[];
  /** Thành viên thêm tay ngay (vai trò `member`), không gồm người tạo. */
  readonly memberUserIds: readonly string[];
  /** Thành viên nở từ phòng ban/vị trí (vai trò `member`, `added_via = sync`). */
  readonly syncedUserIds: readonly string[];
  /** Nguồn thành viên khi `membershipMode = org`. */
  readonly sources: readonly GroupSourceInsert[];
  /** Người được chọn đăng bài khi `postPermission = selected`; đều là thành viên. */
  readonly postPermittedUserIds: readonly string[];
  readonly events: readonly GroupOutboxEvent[];
}

export interface GroupPatch {
  readonly name?: string;
  /** `null` là xoá mô tả. */
  readonly description?: string | null;
  readonly privacy?: SocialGroupPrivacy;
  readonly color?: SocialGroupColor;
  readonly icon?: SocialGroupIcon;
  /** `null` là xoá mô tả rich text. */
  readonly descriptionHtml?: string | null;
  /** `null` về ảnh bìa theo màu. */
  readonly coverPreset?: SocialGroupCoverPreset | null;
  readonly postPermission?: SocialGroupPostPermission;
  /** Thay toàn bộ danh sách người được chọn đăng bài (đều là thành viên). */
  readonly postPermittedUserIds?: readonly string[];
}

export interface GroupMemberRow {
  readonly userId: string;
  readonly role: SocialGroupRole;
  readonly joinedAt: string;
}

export interface GroupMemberListRead {
  readonly groupId: string;
  readonly role?: SocialGroupRole;
  /** Chỉ lấy các thành viên này (kết quả tìm theo tên ở danh bạ). */
  readonly userIds?: readonly string[];
  readonly limit: number;
  /** Cũ nhất trước theo `(joinedAt, userId)`. */
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface JoinRequestRow {
  readonly id: string;
  readonly groupId: string;
  readonly userId: string;
  readonly message?: string;
  readonly status: SocialJoinRequestStatus;
  readonly createdAt: string;
}

export interface JoinRequestWithGroupRow extends JoinRequestRow {
  readonly groupName: string;
}

export interface JoinRequestListRead {
  readonly limit: number;
  /** Cũ nhất trước theo `(createdAt, id)`. */
  readonly cursor?: { readonly at: string; readonly id: string };
}

/**
 * Cổng dữ liệu của nhóm: `groups`, `group_members`, `group_join_requests`. Mọi phương thức nhận
 * `tenantId` đầu tiên. Hàm nhận `events` ghi chúng vào outbox trong cùng transaction.
 *
 * Quy tắc "còn ít nhất một admin" do store giữ nguyên tử (khoá dòng nhóm rồi đếm), nên `setRole`
 * và `remove` ném `SocialGroupLastAdminError` ngay cả khi hai người cùng rời một lúc.
 */
export interface SocialGroupStore {
  readonly groups: {
    /** Nhóm kể cả đã xoá mềm (`deleted`); `viewerId` điền các cột `my*`. */
    find(tenantId: string, groupId: string, viewerId?: string): Promise<GroupRow | undefined>;
    /** Nhóm chưa xoá theo id. */
    refs(tenantId: string, groupIds: readonly string[]): Promise<GroupRow[]>;
    /**
     * Nhóm chưa xoá mà người xem được liệt kê, mới tạo trước. Không có nhóm riêng tư của người ngoài.
     * `scope = mine`: trang đầu (không `cursor`) gồm TẤT CẢ nhóm tôi ưu tiên (ghim mới trước) rồi tới
     * tối đa `limit` nhóm còn lại; trang sau chỉ có nhóm không ưu tiên (con trỏ theo `createdAt`).
     */
    list(tenantId: string, read: GroupListRead): Promise<GroupRow[]>;
    /**
     * Nhóm công khai chưa xoá mà người này chưa là thành viên: nhiều thành viên trước, rồi mới tạo
     * trước. Dùng cho "Các nhóm khác".
     */
    suggestions(tenantId: string, viewerId: string, limit: number): Promise<GroupRow[]>;
    /** Nhóm chưa xoá mà người này là thành viên. */
    memberGroupIds(tenantId: string, userId: string): Promise<string[]>;
    /** Ném `SocialGroupNameTakenError` khi trùng tên (không phân biệt hoa thường). */
    insert(tenantId: string, input: GroupInsert): Promise<void>;
    /** Ném `SocialGroupNameTakenError` khi trùng tên. */
    update(tenantId: string, groupId: string, patch: GroupPatch): Promise<void>;
    softDelete(tenantId: string, groupId: string, userId: string): Promise<void>;
  };

  readonly members: {
    /** `undefined` khi không phải thành viên hoặc nhóm đã xoá. */
    find(tenantId: string, groupId: string, userId: string): Promise<GroupMemberRow | undefined>;
    list(tenantId: string, read: GroupMemberListRead): Promise<GroupMemberRow[]>;
    /** Id thành viên, admin trước rồi người vào sớm; `limit` thiếu là toàn bộ. */
    listIds(tenantId: string, groupId: string, limit?: number): Promise<string[]>;
    listAdminIds(tenantId: string, groupId: string): Promise<string[]>;
    /**
     * Thêm thành viên chưa có (người đã có bị bỏ qua), trả id thực sự được thêm. `events` được gọi
     * với danh sách đó để dựng sự kiện cùng transaction. `addedBy` null là tự tham gia.
     * `addedVia` mặc định `join` khi `addedBy` null, ngược lại `manual`. Thêm tay một người đang là
     * thành viên do đồng bộ đưa vào thì chuyển người đó sang `manual` (đồng bộ sẽ không gỡ nữa).
     */
    add(
      tenantId: string,
      groupId: string,
      userIds: readonly string[],
      role: SocialGroupRole,
      addedBy: string | null,
      events: (inserted: readonly string[]) => readonly GroupOutboxEvent[],
      addedVia?: GroupMemberAddedVia,
    ): Promise<string[]>;
    /**
     * Ném `SocialGroupLastAdminError` khi hạ quyền admin cuối cùng. Trả `false` nếu không phải thành
     * viên. Nâng lên admin thì đặt `added_via = manual` để đồng bộ không bao giờ gỡ người này.
     */
    setRole(tenantId: string, groupId: string, userId: string, role: SocialGroupRole): Promise<boolean>;
    /**
     * Ném `SocialGroupLastAdminError` khi gỡ admin cuối cùng. Trả `false` nếu không phải thành viên.
     * Cùng transaction: xoá ưu tiên (`group_priorities`) và quyền đăng bài được chọn
     * (`group_post_permitted`) của người này trong nhóm.
     */
    remove(tenantId: string, groupId: string, userId: string): Promise<boolean>;
  };

  readonly requests: {
    findPending(tenantId: string, groupId: string, userId: string): Promise<JoinRequestRow | undefined>;
    /** Yêu cầu đang chờ theo id trong nhóm. */
    findPendingById(tenantId: string, groupId: string, requestId: string): Promise<JoinRequestRow | undefined>;
    /** Ném `SocialGroupJoinRequestExistsError` khi đã có yêu cầu đang chờ. */
    create(
      tenantId: string,
      input: {
        readonly id: string;
        readonly groupId: string;
        readonly userId: string;
        readonly message?: string;
        readonly events: readonly GroupOutboxEvent[];
      },
    ): Promise<void>;
    /** Huỷ yêu cầu đang chờ của chính người này; `false` nếu không có. */
    cancel(tenantId: string, groupId: string, userId: string): Promise<boolean>;
    /**
     * Duyệt hoặc từ chối yêu cầu đang chờ. Duyệt thì thêm người xin vào nhóm (vai trò `member`).
     * Trả `undefined` nếu yêu cầu không còn chờ; ngược lại trả thông tin thành viên khi duyệt.
     */
    decide(
      tenantId: string,
      input: {
        readonly groupId: string;
        readonly requestId: string;
        readonly decision: 'approved' | 'rejected';
        readonly decidedBy: string;
        readonly events: readonly GroupOutboxEvent[];
      },
    ): Promise<{ readonly member?: GroupMemberRow } | undefined>;
    listPending(tenantId: string, groupId: string, read: JoinRequestListRead): Promise<JoinRequestRow[]>;
    /** Yêu cầu đang chờ ở mọi nhóm mà người này là admin. */
    inbox(tenantId: string, adminUserId: string, read: JoinRequestListRead): Promise<JoinRequestWithGroupRow[]>;
    inboxCount(tenantId: string, adminUserId: string): Promise<number>;
  };
}
