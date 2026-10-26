import type {
  SocialActivityType,
  SocialGroupColor,
  SocialGroupIcon,
  SocialGroupPrivacy,
  SocialPostStatus,
  SocialPostVisibility,
} from '@enterprise-platform/contracts-social';
import type { PostRow } from '../social-store.port.js';

/**
 * Cột P2/P3 của một bài, thêm vào `PostRow` của P1. Mọi store trả bài cho người dùng (bảng tin,
 * bài của nhóm, tìm kiếm, bài của tôi, bài đã lưu) trả `ExtendedPostRow`; `PostRow` thuần vẫn gán
 * được vào kiểu rộng hơn nên mã P1 không phải đổi.
 *
 * Đọc từ `social_schema.posts` (+ `groups` qua LEFT JOIN cho các cột `group*`).
 */
export interface PostExtras {
  readonly status: SocialPostStatus;
  readonly groupId?: string;
  readonly groupName?: string;
  readonly groupPrivacy?: SocialGroupPrivacy;
  readonly groupColor?: SocialGroupColor;
  readonly groupIcon?: SocialGroupIcon;
  /** Nhóm đã xoá mềm: bài không ai thấy. */
  readonly groupDeleted?: boolean;
  readonly scheduledAt?: string;
  readonly moderatedBy?: string;
  readonly moderatedAt?: string;
  readonly rejectReason?: string;
  readonly requiresReadConfirmation: boolean;
  /** `kind = 'activity'` trong DB; `PostRow.kind` của bài này được store đặt thành `'post'`. */
  readonly activityType?: SocialActivityType;
  readonly activityPayload?: Readonly<Record<string, unknown>>;

  /* ---- Đợt 2 (mặc định ghi cạnh từng trường; store điền từ cột của 0004) ---- */

  /** `posts.visibility`; thiếu là `company`. */
  readonly visibility?: SocialPostVisibility;
  /** `posts.author_unit_id`. */
  readonly authorUnitId?: string;
  /** `posts.comments_disabled`; thiếu là `false`. */
  readonly commentsDisabled?: boolean;
  /** `posts.edit_count`; thiếu là 0. */
  readonly editCount?: number;
  /** `posts.group_topic_id`. Tên chủ đề dựng qua `GroupPostingPort.topicRefs`. */
  readonly groupTopicId?: string;
}

export type ExtendedPostRow = PostRow & PostExtras;

/** Gói quan hệ P2 của một nhóm bài, tra một lần cho cả trang (tránh N+1). Khoá là id bài. */
export interface PostEngagementRelations {
  readonly polls: ReadonlyMap<string, PollRow>;
  /** Chỉ có mục cho bài `requiresReadConfirmation`. */
  readonly readConfirmations: ReadonlyMap<string, ReadConfirmationRow>;
  /** Id bài người xem đã lưu, trong số các id được hỏi. */
  readonly bookmarkedPostIds: ReadonlySet<string>;
  /** Thư mục của bài đã lưu (khoá là id bài); bài chưa phân loại không có mục. */
  readonly bookmarkFolderIds?: ReadonlyMap<string, string>;
  /**
   * Đợt 2. Danh sách chia sẻ của các bài `custom` (khoá là id bài). Chỉ nạp khi cần dựng
   * `SocialPost.audience` (tác giả xem bài của mình) hoặc khi kiểm quyền xem một bài.
   */
  readonly audiences?: ReadonlyMap<string, PostAudienceRow>;
}

export interface PostAudienceRow {
  readonly userIds: readonly string[];
  readonly unitIds: readonly string[];
}

export interface PollOptionRow {
  readonly id: string;
  readonly text: string;
  readonly position: number;
  readonly voteCount: number;
}

export interface PollRow {
  readonly id: string;
  readonly postId: string;
  readonly question: string;
  readonly allowMultiple: boolean;
  readonly anonymous: boolean;
  readonly closesAt?: string;
  readonly closedAt?: string;
  readonly options: readonly PollOptionRow[];
  /** Số người đã bỏ phiếu. */
  readonly totalVoters: number;
  /** Lựa chọn của người đang xem. */
  readonly myOptionIds: readonly string[];
}

export interface ReadConfirmationRow {
  readonly confirmedByMe: boolean;
  readonly confirmedAt?: string;
  readonly confirmedCount: number;
}
