/**
 * Hợp đồng nhóm / thảo luận của Mạng nội bộ (P2).
 *
 * Quyền: mọi thành viên tenant tạo và tham gia nhóm; quản trị nhóm là vai trò `admin` của nhóm.
 * Quản trị tenant và người có `social.manage` là "quản trị toàn hệ thống": thấy và quản lý mọi nhóm
 * (kể cả riêng tư). Nhóm riêng tư không xuất hiện trong danh sách của người ngoài nhóm; người có
 * đường dẫn trực tiếp chỉ nhận bản xem trước (`access = 'preview'`) để gửi yêu cầu tham gia.
 */
import type {
  SocialGroupColor,
  SocialGroupIcon,
  SocialGroupPrivacy,
  SocialUserRef,
} from './contracts-social.js';
import type {
  SocialGroupCoverPreset,
  SocialGroupMemberSource,
  SocialGroupMembershipInput,
  SocialGroupMembershipMode,
  SocialGroupPostPermission,
} from './contracts-social-groups-v2.js';

export const SOCIAL_GROUP_NAME_MAX = 80;
export const SOCIAL_GROUP_DESCRIPTION_MAX = 500;
export const SOCIAL_GROUP_JOIN_MESSAGE_MAX = 300;
/** Thêm tối đa bấy nhiêu người trong một lần gọi. */
export const SOCIAL_GROUP_ADD_MEMBERS_MAX = 100;
export const SOCIAL_GROUP_PAGE_SIZE = 20;
export const SOCIAL_GROUP_MAX_PAGE_SIZE = 50;
/** Số thành viên mẫu kèm trong chi tiết nhóm. */
export const SOCIAL_GROUP_MEMBER_PREVIEW = 6;

export const SOCIAL_GROUP_ROLES = ['admin', 'member'] as const;
export type SocialGroupRole = (typeof SOCIAL_GROUP_ROLES)[number];

export const SOCIAL_GROUP_ROLE_LABELS: Readonly<Record<SocialGroupRole, string>> = {
  admin: 'Quản trị viên',
  member: 'Thành viên',
};

/** `mine`: nhóm tôi là thành viên. `all`: mọi nhóm công khai + nhóm riêng tư tôi là thành viên. */
export const SOCIAL_GROUP_LIST_SCOPES = ['mine', 'all'] as const;
export type SocialGroupListScope = (typeof SOCIAL_GROUP_LIST_SCOPES)[number];

export const SOCIAL_JOIN_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type SocialJoinRequestStatus = (typeof SOCIAL_JOIN_REQUEST_STATUSES)[number];

export const SOCIAL_JOIN_REQUEST_STATUS_LABELS: Readonly<Record<SocialJoinRequestStatus, string>> = {
  pending: 'Đang chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  cancelled: 'Đã huỷ',
};

/** Mã lỗi nghiệp vụ riêng của nhóm (cùng khung lỗi `{ statusCode, code, message }` của phân hệ). */
export const SOCIAL_GROUP_ERROR_CODES = {
  notFound: 'GROUP_NOT_FOUND',
  nameTaken: 'GROUP_NAME_TAKEN',
  notMember: 'GROUP_NOT_MEMBER',
  alreadyMember: 'GROUP_ALREADY_MEMBER',
  lastAdmin: 'GROUP_LAST_ADMIN',
  requestExists: 'GROUP_JOIN_REQUEST_EXISTS',
  requestNotFound: 'GROUP_JOIN_REQUEST_NOT_FOUND',
  privateGroup: 'GROUP_PRIVATE',
} as const;

/** Người xem đang ở đâu so với nhóm. */
export interface SocialGroupMembership {
  readonly role: SocialGroupRole;
  readonly joinedAt: string;
}

export interface SocialGroupCapabilities {
  /** Đăng bài vào nhóm: thành viên. */
  readonly canPost: boolean;
  /** Sửa nhóm, thêm/xoá thành viên, đổi vai trò, duyệt yêu cầu, ghim bài nhóm, đăng bài thông báo. */
  readonly canManage: boolean;
  /** Xoá nhóm: admin nhóm hoặc quản trị toàn hệ thống. */
  readonly canDelete: boolean;
  /** Nhóm công khai và tôi chưa là thành viên. */
  readonly canJoin: boolean;
  /** Nhóm riêng tư, tôi chưa là thành viên và chưa có yêu cầu đang chờ. */
  readonly canRequestJoin: boolean;
  /** Thành viên (kể cả admin nếu còn admin khác). */
  readonly canLeave: boolean;
  /* Đợt 2 (mặc định `false`). */
  /** Đồng bộ lại thành viên từ phòng ban/vị trí: admin nhóm có nguồn thành viên. */
  readonly canSyncMembers?: boolean;
  /** Báo cáo nhóm: người xem được nhóm đầy đủ và không phải admin nhóm. */
  readonly canReport?: boolean;
  /** Đưa nhóm lên trên: thành viên. */
  readonly canPrioritize?: boolean;
}

/** Dòng trong danh sách nhóm và thẻ nhóm. */
export interface SocialGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
  readonly memberCount: number;
  /** Có khi tôi là thành viên. */
  readonly myMembership?: SocialGroupMembership;
  /** Có khi tôi đã gửi yêu cầu tham gia và đang chờ. */
  readonly myJoinRequestId?: string;
  readonly createdAt: string;
  /** Đợt 2. Khoá ảnh bìa mặc định; thiếu thì dùng bìa theo `color`/`icon` như đợt 1. */
  readonly coverPreset?: SocialGroupCoverPreset;
  /** Đợt 2. Thời điểm tôi ưu tiên nhóm này lên trên; chỉ có khi đã ưu tiên. */
  readonly myPriorityAt?: string;
  /** Đợt 2. Mặc định `manual`. */
  readonly membershipMode?: SocialGroupMembershipMode;
}

/**
 * Chi tiết nhóm. `access = 'preview'` (nhóm riêng tư, người xem không phải thành viên, không phải
 * quản trị toàn hệ thống): chỉ có `id`, `name`, `privacy`, `color`, `icon` và `capabilities`;
 * `description`, `memberCount`, `memberPreview` bị bỏ hoặc bằng 0.
 */
export interface SocialGroupDetail extends SocialGroupSummary {
  readonly access: 'full' | 'preview';
  readonly createdBy?: SocialUserRef;
  /** Tối đa `SOCIAL_GROUP_MEMBER_PREVIEW` người, quản trị viên trước. */
  readonly memberPreview: readonly SocialUserRef[];
  readonly adminCount: number;
  /** Số yêu cầu tham gia chờ duyệt; chỉ có khi `capabilities.canManage`. */
  readonly pendingJoinRequestCount?: number;
  readonly capabilities: SocialGroupCapabilities;
  /** Đợt 2. Mô tả rich text, HTML đã làm sạch ở server; `description` là bản chữ thuần cắt ngắn. */
  readonly descriptionHtml?: string;
  /** Đợt 2. Mặc định `all`. */
  readonly postPermission?: SocialGroupPostPermission;
  /** Đợt 2. Người được phép đăng khi `postPermission = 'selected'`; chỉ có cho admin nhóm. */
  readonly postPermittedUsers?: readonly SocialUserRef[];
  /** Đợt 2. Nguồn thành viên khi `membershipMode = 'org'`; chỉ có cho admin nhóm. */
  readonly memberSources?: readonly SocialGroupMemberSource[];
  /** Đợt 2. Lần đồng bộ thành viên gần nhất. */
  readonly lastSyncedAt?: string;
}

export interface SocialGroupPage {
  readonly items: readonly SocialGroupSummary[];
  readonly nextCursor?: string;
}

export interface SocialGroupListQuery {
  readonly scope?: SocialGroupListScope;
  /** Tìm theo tên/mô tả, không phân biệt dấu và hoa thường. */
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CreateSocialGroupRequest {
  readonly name: string;
  readonly description?: string;
  readonly privacy: SocialGroupPrivacy;
  /** Mặc định `SOCIAL_GROUP_DEFAULT_COLOR`. */
  readonly color?: SocialGroupColor;
  /** Mặc định `SOCIAL_GROUP_DEFAULT_ICON`. */
  readonly icon?: SocialGroupIcon;
  /** Thành viên thêm ngay (vai trò `member`); người tạo luôn là `admin`. */
  readonly memberUserIds?: readonly string[];
  /** Đợt 2. Mô tả rich text (HTML); server làm sạch và tự tính `description` chữ thuần. Ưu tiên hơn `description`. */
  readonly descriptionHtml?: string;
  /** Đợt 2. Ảnh bìa mặc định. */
  readonly coverPreset?: SocialGroupCoverPreset;
  /** Đợt 2. Quản lý thêm (người tạo luôn là quản lý). Tối đa `SOCIAL_GROUP_ADMIN_MAX`. */
  readonly adminUserIds?: readonly string[];
  /**
   * Đợt 2. Cách chọn thành viên. Thiếu thì dùng `memberUserIds` như đợt 1.
   * `org`: nở thành viên từ phòng ban/vị trí tại thời điểm tạo; đồng bộ lại sau bằng `sync-members`.
   */
  readonly membership?: SocialGroupMembershipInput;
  /** Đợt 2. Ai được đăng bài. Mặc định `all`. */
  readonly postPermission?: SocialGroupPostPermission;
  /** Đợt 2. Bắt buộc không rỗng khi `postPermission = 'selected'` (admin luôn được đăng). */
  readonly postPermittedUserIds?: readonly string[];
}

export interface UpdateSocialGroupRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly privacy?: SocialGroupPrivacy;
  readonly color?: SocialGroupColor;
  readonly icon?: SocialGroupIcon;
  /** Đợt 2. */
  readonly descriptionHtml?: string | null;
  readonly coverPreset?: SocialGroupCoverPreset | null;
  readonly postPermission?: SocialGroupPostPermission;
  /** Thay toàn bộ danh sách khi `postPermission = 'selected'`. */
  readonly postPermittedUserIds?: readonly string[];
}

export interface SocialGroupMember {
  readonly user: SocialUserRef;
  readonly role: SocialGroupRole;
  readonly joinedAt: string;
}

export interface SocialGroupMemberPage {
  readonly items: readonly SocialGroupMember[];
  readonly nextCursor?: string;
}

export interface SocialGroupMemberQuery {
  readonly role?: SocialGroupRole;
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface AddSocialGroupMembersRequest {
  readonly userIds: readonly string[];
  /** Mặc định `member`. */
  readonly role?: SocialGroupRole;
}

export interface AddSocialGroupMembersResponse {
  /** Người mới vào nhóm. Người đã là thành viên bị bỏ qua, không lỗi. */
  readonly added: readonly SocialUserRef[];
  /** Id không có trong danh bạ. */
  readonly skippedUnknown: readonly string[];
}

export interface UpdateSocialGroupMemberRequest {
  readonly role: SocialGroupRole;
}

export interface JoinSocialGroupRequest {
  /** Chỉ dùng cho nhóm riêng tư. */
  readonly message?: string;
}

export interface JoinSocialGroupResponse {
  /** `joined`: nhóm công khai, đã là thành viên. `requested`: nhóm riêng tư, chờ admin duyệt. */
  readonly result: 'joined' | 'requested';
  readonly group: SocialGroupDetail;
}

export interface SocialJoinRequest {
  readonly id: string;
  readonly groupId: string;
  readonly user: SocialUserRef;
  readonly message?: string;
  readonly status: SocialJoinRequestStatus;
  readonly createdAt: string;
}

export interface SocialJoinRequestPage {
  readonly items: readonly SocialJoinRequest[];
  readonly nextCursor?: string;
}

/** Yêu cầu chờ duyệt ở mọi nhóm tôi là admin (cho màn "Cần xử lý"). */
export interface SocialJoinRequestWithGroup extends SocialJoinRequest {
  readonly group: { readonly id: string; readonly name: string };
}

export interface SocialJoinRequestInboxPage {
  readonly items: readonly SocialJoinRequestWithGroup[];
  /** Tổng số yêu cầu đang chờ tôi duyệt, để hiện chấm số. */
  readonly totalCount: number;
  readonly nextCursor?: string;
}

/** Sự kiện outbox của nhóm. */
export interface SocialGroupMemberAddedPayload {
  readonly groupId: string;
  readonly groupName: string;
  readonly userId: string;
  /** Người thêm, hoặc người duyệt yêu cầu. */
  readonly addedBy: string;
  readonly addedByName: string;
  /** Đợt 2: `synced` là thêm do tạo nhóm theo phòng ban/vị trí hoặc đồng bộ lại; thông báo xử lý như `invited`. */
  readonly via: 'invited' | 'approved' | 'synced';
}

export interface SocialGroupJoinRequestedPayload {
  readonly groupId: string;
  readonly groupName: string;
  readonly requestId: string;
  readonly requesterId: string;
  readonly requesterName: string;
  /** Admin của nhóm tại thời điểm gửi: người nhận thông báo (thông báo không đọc được bảng nhóm). */
  readonly adminUserIds: readonly string[];
}

export interface SocialGroupJoinDecidedPayload {
  readonly groupId: string;
  readonly groupName: string;
  readonly requestId: string;
  readonly requesterId: string;
  readonly decision: 'approved' | 'rejected';
  readonly decidedBy: string;
}
