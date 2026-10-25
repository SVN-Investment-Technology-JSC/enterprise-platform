/**
 * Hợp đồng trang cá nhân, tìm kiếm, sinh nhật và realtime của Mạng nội bộ (P3).
 *
 * Hồ sơ và ngày sinh thuộc HRM/Core: phân hệ chỉ đọc qua API khi cần, không sao chép vào
 * `social_schema`. Dữ liệu cá nhân nhạy cảm (năm sinh, số điện thoại) không đi qua hợp đồng này.
 */
import type { SocialFeedPage, SocialPost, SocialUserRef } from './contracts-social.js';
import type { SocialGroupSummary } from './contracts-social-groups.js';

/* ---------------------------------------------------------------- hồ sơ */

/** Đường dẫn sang HRM để xem hồ sơ nhân sự; chỉ là liên kết, không dựng lại. */
export const SOCIAL_HRM_LINKS = {
  /**
   * Danh sách nhân viên HRM (route có thật: `apps/hrm-web/src/app/employees`). Quá trình làm việc nằm
   * trong chi tiết nhân viên mở từ danh sách; HRM chưa có đường dẫn trực tiếp tới một nhân viên, nên chỉ
   * liên kết tới danh sách. Chỉ hiện nút khi `SocialPersonProfile.canOpenInHrm`.
   */
  employees: '/modules/hrm/employees',
} as const;

/** Ngày và tháng sinh; KHÔNG kèm năm. */
export interface SocialBirthday {
  readonly day: number;
  readonly month: number;
}

export interface SocialPersonProfile {
  readonly user: SocialUserRef;
  readonly isSelf: boolean;
  readonly unitName?: string;
  readonly position?: string;
  readonly email?: string;
  readonly birthday?: SocialBirthday;
  /** Ngày vào công ty (ISO ngày). */
  readonly joinedAt?: string;
  /** Mã nhân viên (từ HRM); thiếu khi HRM không có hoặc không trả lời. */
  readonly employeeCode?: string;
  /** Số bài đã đăng mà người xem thấy được (Tường công ty + nhóm xem được; không tính bài tự sinh). */
  readonly postCount: number;
  /** Người xem có quyền sang HRM xem hồ sơ nhân sự của người này. */
  readonly canOpenInHrm: boolean;
}

/* ------------------------------------------------------------- sinh nhật */

export const SOCIAL_BIRTHDAY_DEFAULT_DAYS = 7;
export const SOCIAL_BIRTHDAY_MAX_DAYS = 30;

export interface SocialUpcomingBirthday {
  readonly user: SocialUserRef;
  readonly birthday: SocialBirthday;
  /** 0 là hôm nay. */
  readonly daysUntil: number;
}

export interface SocialBirthdays {
  /** Sinh nhật hôm nay (theo múi giờ của công ty). */
  readonly today: readonly SocialUpcomingBirthday[];
  /** Từ ngày mai đến hết `days` ngày tới, gần nhất trước. */
  readonly upcoming: readonly SocialUpcomingBirthday[];
}

export interface SocialBirthdaysQuery {
  /** 1–`SOCIAL_BIRTHDAY_MAX_DAYS`; mặc định `SOCIAL_BIRTHDAY_DEFAULT_DAYS`. */
  readonly days?: number;
}

/* -------------------------------------- trang riêng /birthday (đợt 2) */

export const SOCIAL_BIRTHDAY_LIST_DEFAULT_MONTHS = 12;
export const SOCIAL_BIRTHDAY_LIST_MAX_MONTHS = 12;
/** Chặn kích thước phản hồi: tối đa bấy nhiêu người mỗi lần. */
export const SOCIAL_BIRTHDAY_LIST_MAX_ITEMS = 500;

/** `GET /birthdays/list?q&months`. */
export interface SocialBirthdayListQuery {
  /** Tìm theo tên, không phân biệt dấu và hoa thường. */
  readonly q?: string;
  /** Số tháng tính từ tháng hiện tại, 1–`SOCIAL_BIRTHDAY_LIST_MAX_MONTHS`; mặc định `SOCIAL_BIRTHDAY_LIST_DEFAULT_MONTHS`. */
  readonly months?: number;
}

export interface SocialBirthdayListItem {
  /** `user.unitName` là đơn vị hiển thị; chữ cái đại diện avatar do giao diện suy ra từ `user.name`. */
  readonly user: SocialUserRef;
  readonly birthday: SocialBirthday;
  /** Lần sinh nhật tới (hoặc hôm nay), ISO ngày `YYYY-MM-DD`, theo múi giờ của công ty. */
  readonly nextDate: string;
  /** 0 là hôm nay. */
  readonly daysUntil: number;
  /**
   * Tuổi sẽ tròn vào `nextDate`. Chỉ có khi HRM có năm sinh; năm sinh KHÔNG BAO GIỜ đi qua hợp đồng
   * này, chỉ có tuổi đã tính sẵn ở server.
   */
  readonly turningAge?: number;
}

export interface SocialBirthdayMonthSection {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** Trong tháng: ngày tăng dần, rồi tên. Tháng hiện tại chỉ gồm từ hôm nay trở đi. */
  readonly items: readonly SocialBirthdayListItem[];
}

export interface SocialBirthdayList {
  /** Ngày "hôm nay" theo múi giờ của công ty, `YYYY-MM-DD`. */
  readonly today: string;
  /** Chỉ các tháng có người; thứ tự thời gian bắt đầu từ tháng hiện tại. */
  readonly sections: readonly SocialBirthdayMonthSection[];
  readonly totalCount: number;
}

/* ------------------------------------------------------------ tìm kiếm */

export const SOCIAL_SEARCH_QUERY_MIN = 2;
export const SOCIAL_SEARCH_QUERY_MAX = 100;
export const SOCIAL_SEARCH_MAX_TERMS = 5;
/** Số mục mỗi nhóm kết quả trong tìm kiếm tổng hợp. */
export const SOCIAL_SEARCH_OVERVIEW_LIMIT = 5;

export interface SocialSearchPostsQuery {
  readonly q: string;
  readonly topicId?: string;
  readonly groupId?: string;
  readonly authorId?: string;
  /** ISO 8601; bao gồm cả hai đầu. Lọc theo `publishedAt`. */
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SocialSearchPeopleQuery {
  readonly q: string;
  readonly limit?: number;
}

export interface SocialSearchGroupsQuery {
  readonly q: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SocialSearchPeopleResponse {
  readonly items: readonly SocialUserRef[];
}

/** Bài tìm thấy dùng đúng `SocialFeedPage`; sắp xếp mới nhất trước (không xếp hạng độ khớp). */
export type SocialSearchPostsResponse = SocialFeedPage;

export interface SocialSearchOverview {
  readonly query: string;
  readonly posts: readonly SocialPost[];
  readonly people: readonly SocialUserRef[];
  readonly groups: readonly SocialGroupSummary[];
}

/* ------------------------------------------------------------ bài tự sinh */

/**
 * Sự kiện của phân hệ khác mà Mạng nội bộ nghe để tự sinh bài `kind = 'activity'`.
 * Chưa có phân hệ nào phát `avatarUpdated` (hệ thống chưa có chức năng đổi ảnh đại diện); khi có, bên
 * phát ghi sự kiện này qua outbox với payload `SocialAvatarUpdatedSourcePayload`.
 */
export const SOCIAL_ACTIVITY_SOURCE_EVENTS = {
  avatarUpdated: 'core.user.avatar-updated',
} as const;

export interface SocialAvatarUpdatedSourcePayload {
  /** Người vừa đổi ảnh đại diện; cũng là tác giả bài tự sinh. */
  readonly userId: string;
}

/* ------------------------------------------------------------- realtime */

/**
 * Sự kiện socket cho Mạng nội bộ. Tên này phải được thêm vào `REALTIME_SERVER_EVENTS` của
 * contracts-realtime (BE-3). Chỉ mang định danh: người nhận gọi lại API có kiểm quyền để lấy
 * nội dung, nên không lộ nội dung bài nhóm riêng tư qua broker.
 */
export const SOCIAL_REALTIME_EVENT = 'social.feed.changed' as const;

export const SOCIAL_FEED_CHANGES = [
  'post.created',
  'post.updated',
  'post.deleted',
  'comment.changed',
  'reaction.changed',
  'poll.changed',
] as const;
export type SocialFeedChange = (typeof SOCIAL_FEED_CHANGES)[number];

export interface SocialFeedSignal {
  readonly change: SocialFeedChange;
  readonly postId: string;
  /** Thiếu là bài Tường công ty. */
  readonly groupId?: string;
  readonly actorUserId: string;
}
