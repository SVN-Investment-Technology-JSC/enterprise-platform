/**
 * Hợp đồng đợt 2 của nhóm: tạo nhóm theo phòng ban/vị trí, quyền đăng bài, chủ đề nhóm, ưu tiên
 * lên trên, báo cáo, nhóm gợi ý. Các trường thêm vào kiểu có sẵn (tạo/sửa nhóm, chi tiết nhóm) nằm
 * ngay ở `contracts-social-groups.ts`; file này chứa kiểu mới.
 *
 * Ghi chú `isPublic` (1Office): tương đương `privacy === 'public'`; không thêm trường thứ hai.
 */
import type { SocialUserRef } from './contracts-social.js';
import type { SocialGroupSummary } from './contracts-social-groups.js';
import type { SocialOrgNodeKind } from './contracts-social-visibility.js';

/* ------------------------------------------------ hằng và nhãn */

export const SOCIAL_GROUP_DESCRIPTION_HTML_MAX = 5_000;
/** Số quản lý tối đa của một nhóm (kể cả người tạo). */
export const SOCIAL_GROUP_ADMIN_MAX = 20;
export const SOCIAL_GROUP_POST_PERMITTED_MAX = 200;
export const SOCIAL_GROUP_MEMBER_SOURCES_MAX = 20;
/** Số nhóm tối đa tôi ưu tiên lên trên. */
export const SOCIAL_GROUP_PRIORITY_MAX = 10;
export const SOCIAL_GROUP_SUGGESTION_LIMIT = 10;
export const SOCIAL_GROUP_TOPIC_NAME_MAX = 60;
export const SOCIAL_GROUP_TOPICS_MAX = 30;

/** Ai được đăng bài vào nhóm. Admin nhóm luôn đăng được. */
export const SOCIAL_GROUP_POST_PERMISSIONS = ['all', 'admins', 'selected'] as const;
export type SocialGroupPostPermission = (typeof SOCIAL_GROUP_POST_PERMISSIONS)[number];

export const SOCIAL_GROUP_POST_PERMISSION_LABELS: Readonly<Record<SocialGroupPostPermission, string>> = {
  all: 'Tất cả thành viên',
  admins: 'Chỉ quản lý nhóm',
  selected: 'Những người được chọn',
};

/** `manual`: thêm tay từng người. `org`: nở từ phòng ban/vị trí, đồng bộ lại được. */
export const SOCIAL_GROUP_MEMBERSHIP_MODES = ['manual', 'org'] as const;
export type SocialGroupMembershipMode = (typeof SOCIAL_GROUP_MEMBERSHIP_MODES)[number];

export const SOCIAL_GROUP_MEMBERSHIP_MODE_LABELS: Readonly<Record<SocialGroupMembershipMode, string>> = {
  manual: 'Theo danh sách người dùng',
  org: 'Theo phòng ban / vị trí',
};

/**
 * Ảnh bìa mặc định; giao diện ánh xạ khoá sang ảnh/gradient. Đổi `color` vẫn đổi tông màu bìa.
 * Thêm khoá mới không cần migration (cột chỉ lưu chuỗi).
 */
export const SOCIAL_GROUP_COVER_PRESETS = [
  'aurora',
  'ocean',
  'forest',
  'sunset',
  'mountain',
  'city',
  'geometric',
  'paper',
] as const;
export type SocialGroupCoverPreset = (typeof SOCIAL_GROUP_COVER_PRESETS)[number];

export const SOCIAL_GROUP_COVER_PRESET_LABELS: Readonly<Record<SocialGroupCoverPreset, string>> = {
  aurora: 'Cực quang',
  ocean: 'Đại dương',
  forest: 'Rừng xanh',
  sunset: 'Hoàng hôn',
  mountain: 'Núi non',
  city: 'Thành phố',
  geometric: 'Hình khối',
  paper: 'Giấy',
};

export const SOCIAL_GROUP_DEFAULT_COVER_PRESET: SocialGroupCoverPreset = 'aurora';

/** Mã lỗi nghiệp vụ đợt 2 của nhóm. */
export const SOCIAL_GROUP_V2_ERROR_CODES = {
  /** 403: nhóm hạn chế người đăng và người gọi không được phép. */
  postNotAllowed: 'GROUP_POST_NOT_ALLOWED',
  topicNotFound: 'GROUP_TOPIC_NOT_FOUND',
  topicNameTaken: 'GROUP_TOPIC_NAME_TAKEN',
  topicLimit: 'GROUP_TOPIC_LIMIT',
  /** 409: vượt `SOCIAL_GROUP_PRIORITY_MAX`. */
  priorityLimit: 'GROUP_PRIORITY_LIMIT',
  /** 400: nhóm không ở chế độ `org` hoặc chưa có nguồn thành viên. */
  noMemberSources: 'GROUP_NO_MEMBER_SOURCES',
  /** 400: nguồn không có trong sơ đồ tổ chức. */
  sourceUnknown: 'GROUP_SOURCE_UNKNOWN',
  /** 409: đã báo cáo mục này và báo cáo còn đang mở. */
  reportExists: 'REPORT_EXISTS',
  reportNotFound: 'REPORT_NOT_FOUND',
  /** 409: báo cáo đã được xử lý. */
  reportHandled: 'REPORT_HANDLED',
} as const;

/* -------------------------------------------- thành viên theo phòng ban */

export interface SocialGroupMemberSourceInput {
  readonly type: SocialOrgNodeKind;
  /** Id nút trong sơ đồ tổ chức. */
  readonly id: string;
  /** Mặc định `true`: gồm cả người ở các nút con. */
  readonly includeDescendants?: boolean;
}

export interface SocialGroupMemberSource {
  /** Id dòng nguồn trong nhóm. */
  readonly id: string;
  readonly type: SocialOrgNodeKind;
  /** Id nút trong sơ đồ tổ chức. */
  readonly sourceId: string;
  /** Tên tại thời điểm lưu; có thể lệch nếu sơ đồ đổi tên. */
  readonly name: string;
  readonly includeDescendants: boolean;
}

export type SocialGroupMembershipInput =
  | { readonly mode: 'manual'; readonly userIds?: readonly string[] }
  | { readonly mode: 'org'; readonly sources: readonly SocialGroupMemberSourceInput[] };

/** `PUT /groups/:id/member-sources`: thay toàn bộ danh sách nguồn; không tự thêm/xoá người. */
export interface SetSocialGroupMemberSourcesRequest {
  /** Rỗng là bỏ nguồn và trả nhóm về `manual`. */
  readonly sources: readonly SocialGroupMemberSourceInput[];
}

export interface SyncSocialGroupMembersRequest {
  /**
   * Mặc định `false`: chỉ THÊM người mới của các nguồn. `true`: gỡ thêm các thành viên do đồng bộ
   * mang vào mà không còn thuộc nguồn nào; không bao giờ gỡ admin hoặc người được thêm tay/tự tham gia.
   */
  readonly prune?: boolean;
}

export interface SyncSocialGroupMembersResponse {
  readonly added: readonly SocialUserRef[];
  readonly removedCount: number;
  readonly memberCount: number;
  readonly syncedAt: string;
}

/* -------------------------------------------------- chủ đề của nhóm */

export interface SocialGroupTopic {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly position: number;
  /** Số bài đã đăng thuộc chủ đề mà người xem thấy được. */
  readonly postCount: number;
}

export interface SocialGroupTopicList {
  readonly items: readonly SocialGroupTopic[];
}

export interface CreateSocialGroupTopicRequest {
  readonly name: string;
}

export interface UpdateSocialGroupTopicRequest {
  readonly name?: string;
  readonly position?: number;
}

/* ------------------------------------------------ ưu tiên và gợi ý */

export interface SetSocialGroupPriorityRequest {
  readonly pinned: boolean;
}

export interface SocialGroupPriorityState {
  readonly pinned: boolean;
  readonly pinnedAt?: string;
}

/** `GET /groups/suggestions`: nhóm công khai tôi chưa tham gia, nhiều thành viên trước. Không phân trang. */
export interface SocialGroupSuggestions {
  readonly items: readonly SocialGroupSummary[];
}

/* ----------------------------------------------------------- báo cáo */

export const SOCIAL_REPORT_TARGET_TYPES = ['group', 'post', 'comment'] as const;
export type SocialReportTargetType = (typeof SOCIAL_REPORT_TARGET_TYPES)[number];

export const SOCIAL_REPORT_TARGET_LABELS: Readonly<Record<SocialReportTargetType, string>> = {
  group: 'Nhóm',
  post: 'Bài viết',
  comment: 'Bình luận',
};

export const SOCIAL_REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type SocialReportStatus = (typeof SOCIAL_REPORT_STATUSES)[number];

export const SOCIAL_REPORT_STATUS_LABELS: Readonly<Record<SocialReportStatus, string>> = {
  open: 'Chưa xử lý',
  resolved: 'Đã xử lý',
  dismissed: 'Bỏ qua',
};

export const SOCIAL_REPORT_REASON_MIN = 5;
export const SOCIAL_REPORT_REASON_MAX = 500;
export const SOCIAL_REPORT_NOTE_MAX = 500;

/** Lý do gợi ý để giao diện hiện sẵn; lý do gửi lên vẫn là chuỗi tự do. */
export const SOCIAL_REPORT_SUGGESTED_REASONS: readonly string[] = [
  'Nội dung không phù hợp',
  'Spam hoặc quảng cáo',
  'Thông tin sai sự thật',
  'Xúc phạm hoặc quấy rối',
  'Lộ thông tin nội bộ',
];

export interface CreateSocialReportRequest {
  readonly targetType: SocialReportTargetType;
  readonly targetId: string;
  readonly reason: string;
}

export interface ResolveSocialReportRequest {
  readonly status: Exclude<SocialReportStatus, 'open'>;
  readonly note?: string;
}

/** Tóm tắt đối tượng bị báo cáo, dựng khi đọc; thiếu khi đối tượng đã xoá hoặc người xem không thấy nữa. */
export interface SocialReportTargetSummary {
  /** Tên nhóm, tiêu đề bài, hoặc đoạn đầu bình luận (tối đa 120 ký tự, chữ thuần). */
  readonly label: string;
  readonly postId?: string;
  readonly commentId?: string;
  readonly authorName?: string;
}

export interface SocialReport {
  readonly id: string;
  readonly targetType: SocialReportTargetType;
  readonly targetId: string;
  readonly status: SocialReportStatus;
  readonly reason: string;
  readonly reporter: SocialUserRef;
  readonly createdAt: string;
  readonly group?: { readonly id: string; readonly name: string };
  readonly target?: SocialReportTargetSummary;
  readonly handledBy?: SocialUserRef;
  readonly handledAt?: string;
  readonly handleNote?: string;
}

export interface SocialReportPage {
  readonly items: readonly SocialReport[];
  /** Số báo cáo đang mở trong hàng đợi này, để hiện chấm số. */
  readonly openCount: number;
  readonly nextCursor?: string;
}

export interface SocialReportListQuery {
  /** Mặc định `open`. */
  readonly status?: SocialReportStatus;
  readonly targetType?: SocialReportTargetType;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Sự kiện outbox `social.report.created`. */
export interface SocialReportCreatedPayload {
  readonly reportId: string;
  readonly targetType: SocialReportTargetType;
  readonly targetId: string;
  readonly reporterId: string;
  readonly reporterName: string;
  readonly groupId?: string;
  readonly groupName?: string;
  /**
   * Người nhận khi báo cáo thuộc nhóm (admin nhóm). Thiếu thì người nhận là mọi moderator
   * (bài/bình luận Tường công ty, và nhóm công khai cùng với admin nhóm).
   */
  readonly recipientUserIds?: readonly string[];
  /** Cho phép catalog thông báo bỏ qua người nhận không thấy nhóm riêng tư. */
  readonly groupPrivacy?: 'public' | 'private';
}
