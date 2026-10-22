import type {
  SocialGroupColor,
  SocialGroupIcon,
  SocialGroupPrivacy,
  SocialGroupRef,
  SocialGroupRole,
} from '@enterprise-platform/contracts-social';

/**
 * Cổng tra cứu thành viên nhóm.
 *
 * BE-1 (đường ghi bài) và BE-3 (tìm kiếm, thông báo) chỉ dùng cổng này; BE-2 (nhóm) hiện thực nó
 * trên `social_schema.groups` / `group_members` và sở hữu mọi truy vấn vào hai bảng đó.
 * Mọi phương thức nhận `tenantId` đầu tiên và không ném lỗi khi không tìm thấy.
 */
export const GROUP_MEMBERSHIP = Symbol('SOCIAL_GROUP_MEMBERSHIP');

export interface GroupAccessInfo {
  readonly id: string;
  readonly name: string;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
  /** Nhóm đã xoá mềm: coi như không tồn tại với mọi thao tác ghi. */
  readonly deleted: boolean;
}

export interface GroupMembershipInfo {
  readonly role: SocialGroupRole;
  readonly joinedAt: string;
}

export interface GroupMembershipPort {
  /** Nhóm kể cả đã xoá mềm; `undefined` nếu id không có. */
  getGroup(tenantId: string, groupId: string): Promise<GroupAccessInfo | undefined>;

  /** Thông tin thành viên của người này trong nhóm; `undefined` nếu không phải thành viên (hoặc nhóm đã xoá). */
  membershipOf(tenantId: string, groupId: string, userId: string): Promise<GroupMembershipInfo | undefined>;

  isMember(tenantId: string, groupId: string, userId: string): Promise<boolean>;

  /** Admin của nhóm (vai trò `admin`). Không gồm quản trị toàn hệ thống. */
  isAdmin(tenantId: string, groupId: string, userId: string): Promise<boolean>;

  /** Id các nhóm chưa xoá mà người này là thành viên, mọi vai trò. */
  memberGroupIds(tenantId: string, userId: string): Promise<readonly string[]>;

  /**
   * Id thành viên của nhóm (admin trước). Dùng để tính người cần xác nhận đã đọc và người nhận
   * thông báo. `limit` tối đa; thiếu là toàn bộ.
   */
  listMemberIds(tenantId: string, groupId: string, limit?: number): Promise<readonly string[]>;

  /** Id các admin của nhóm; dùng làm người nhận thông báo yêu cầu tham gia. */
  listAdminIds(tenantId: string, groupId: string): Promise<readonly string[]>;

  /** Nhóm rút gọn theo id, bỏ nhóm không có hoặc đã xoá. */
  groupRefs(tenantId: string, groupIds: readonly string[]): Promise<ReadonlyMap<string, SocialGroupRef>>;
}
