import type {
  SocialGroupMembershipMode,
  SocialGroupPostPermission,
  SocialGroupRole,
} from '@enterprise-platform/contracts-social';
import type { GroupOutboxEvent, GroupSourceInsert } from './social-group-store.port.js';

/** Token DI của store nhóm đợt 2 (chủ đề, ưu tiên, nguồn thành viên, đồng bộ, quyền đăng bài). */
export const SOCIAL_GROUP_V2_STORE = Symbol('SOCIAL_GROUP_V2_STORE');

/** Thông tin một nhóm đủ để quyết định quyền đăng bài của một người. */
export interface GroupPostingInfo {
  readonly deleted: boolean;
  readonly postPermission: SocialGroupPostPermission;
  /** Vai trò của người này trong nhóm; thiếu là không phải thành viên. */
  readonly role?: SocialGroupRole;
  /** Có trong `group_post_permitted`. */
  readonly permitted: boolean;
}

export interface GroupTopicRow {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly position: number;
  /** Bài đã đăng, chưa xoá thuộc chủ đề. */
  readonly postCount: number;
}

export interface GroupTopicRefRow {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
}

export interface GroupSourceRow {
  readonly id: string;
  readonly type: GroupSourceInsert['type'];
  readonly sourceId: string;
  readonly name: string;
  readonly includeDescendants: boolean;
}

export interface GroupSyncInput {
  readonly groupId: string;
  /** Mọi người đang thuộc các nguồn tại thời điểm đồng bộ (viết thường, không trùng). */
  readonly desiredUserIds: readonly string[];
  /** Gỡ thêm người `added_via = sync` không còn thuộc nguồn nào (không bao giờ gỡ admin). */
  readonly prune: boolean;
  readonly actorId: string;
  /** Dựng sự kiện từ danh sách người thực sự được thêm; chạy cùng transaction. */
  readonly events: (added: readonly string[]) => readonly GroupOutboxEvent[];
}

export interface GroupSyncResult {
  readonly added: readonly string[];
  readonly removedCount: number;
  readonly memberCount: number;
  readonly syncedAt: string;
}

/**
 * Cổng dữ liệu nhóm đợt 2: `group_post_permitted`, `group_topics`, `group_priorities`,
 * `group_member_sources` và đồng bộ thành viên. Mọi phương thức nhận `tenantId` đầu tiên.
 * Các thay đổi nhiều bước (ưu tiên có giới hạn, đồng bộ) nguyên tử trong store.
 */
export interface SocialGroupV2Store {
  readonly posting: {
    /** `undefined` khi nhóm không có. */
    info(tenantId: string, groupId: string, userId: string): Promise<GroupPostingInfo | undefined>;
    /** Người được chọn đăng bài, theo thứ tự thêm. */
    permittedUserIds(tenantId: string, groupId: string): Promise<string[]>;
  };

  readonly topics: {
    list(tenantId: string, groupId: string): Promise<GroupTopicRow[]>;
    /**
     * Ném `SocialGroupTopicNameTakenError` khi trùng tên (không phân biệt hoa thường) và
     * `SocialGroupTopicLimitError` khi nhóm đã đủ `SOCIAL_GROUP_TOPICS_MAX` chủ đề. Vị trí là cuối danh sách.
     */
    create(
      tenantId: string,
      input: { readonly id: string; readonly groupId: string; readonly name: string; readonly createdBy: string },
    ): Promise<GroupTopicRow>;
    /** `undefined` khi chủ đề không thuộc nhóm. Ném `SocialGroupTopicNameTakenError` khi trùng tên. */
    update(
      tenantId: string,
      groupId: string,
      topicId: string,
      patch: { readonly name?: string; readonly position?: number },
    ): Promise<GroupTopicRow | undefined>;
    /** Bài của chủ đề về không chủ đề (khoá ngoại `ON DELETE SET NULL`). `false` khi không có. */
    remove(tenantId: string, groupId: string, topicId: string): Promise<boolean>;
    /** Chủ đề theo id; `groupId` thiếu là bất kể nhóm. Không trả chủ đề của nhóm đã xoá. */
    byIds(tenantId: string, topicIds: readonly string[], groupId?: string): Promise<GroupTopicRefRow[]>;
  };

  readonly priorities: {
    /**
     * Đặt hoặc bỏ ưu tiên nhóm của một người, nguyên tử theo người (khoá cố vấn). Đã ưu tiên rồi mà
     * ưu tiên nữa thì giữ nguyên `pinnedAt`. Ném `SocialGroupPriorityLimitError` khi vượt `max`.
     */
    set(
      tenantId: string,
      groupId: string,
      userId: string,
      pinned: boolean,
      max: number,
    ): Promise<{ readonly pinned: boolean; readonly pinnedAt?: string }>;
  };

  readonly sources: {
    list(tenantId: string, groupId: string): Promise<GroupSourceRow[]>;
    /** Thay toàn bộ nguồn và đặt `membership_mode` (`org` khi còn nguồn, ngược lại `manual`). */
    replace(
      tenantId: string,
      groupId: string,
      sources: readonly GroupSourceInsert[],
      mode: SocialGroupMembershipMode,
    ): Promise<void>;
  };

  readonly sync: {
    /**
     * Thêm người mới (`added_via = sync`, vai trò `member`) và, nếu `prune`, gỡ thành viên
     * `added_via = sync` vai trò `member` không còn trong `desiredUserIds`. Ghi `last_synced_at/by`.
     */
    apply(tenantId: string, input: GroupSyncInput): Promise<GroupSyncResult | undefined>;
  };
}
