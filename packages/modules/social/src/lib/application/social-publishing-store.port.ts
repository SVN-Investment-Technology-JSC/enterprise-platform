import type {
  SocialPostKind,
  SocialPostStatus,
  SocialPostVisibility,
  SocialReactionType,
} from '@enterprise-platform/contracts-social';
import type { ExtendedPostRow, PostEngagementRelations } from './ports/post-read-model.js';
import type { PostVisibilityScope } from './ports/post-visibility.port.js';
import type { SocialOutboxEvent } from './social-store.port.js';

/** Token DI của store đường ghi bài (BE-1). Hiện thực: `PostgresSocialPublishingStore`. */
export const SOCIAL_PUBLISHING_STORE = Symbol('SOCIAL_PUBLISHING_STORE');

/**
 * Bài đọc để ghi hoặc để kiểm quyền xem MỘT bài: thêm danh sách chia sẻ của bài `custom` (đã nạp từ
 * `post_audience`), khớp `PostVisibilitySubject` nên đưa thẳng vào `PostVisibilityPort.canView`.
 */
export type WritablePostRow = ExtendedPostRow & {
  readonly audienceUserIds?: readonly string[];
  readonly audienceUnitIds?: readonly string[];
};

/** Danh sách chia sẻ của bài `custom`: id người và id nút tổ chức (viết thường, không trùng). */
export interface PostAudienceWrite {
  readonly userIds: readonly string[];
  readonly unitIds: readonly string[];
}

export interface PollInsert {
  readonly id: string;
  readonly question: string;
  readonly allowMultiple: boolean;
  readonly anonymous: boolean;
  /** ISO UTC. */
  readonly closesAt?: string;
  /** Theo thứ tự hiển thị; `position` là chỉ số trong mảng. */
  readonly options: readonly { readonly id: string; readonly text: string }[];
}

export interface PublishingPostInsert {
  readonly id: string;
  readonly authorId: string;
  readonly kind: SocialPostKind;
  readonly title?: string;
  readonly bodyHtml: string;
  readonly topicId?: string;
  readonly groupId?: string;
  readonly pinned: boolean;
  readonly mentionsAll: boolean;
  readonly mentionUserIds: readonly string[];
  readonly attachmentIds: readonly string[];
  /** Người tải các tệp (tác giả). */
  readonly uploaderId: string;
  readonly status: 'published' | 'pending' | 'scheduled';
  /** Bắt buộc khi `status = 'scheduled'`. */
  readonly scheduledAt?: string;
  /** Chỉ có nghĩa với bài `scheduled`: đặt dấu miễn duyệt (`moderated_by = author_id`). */
  readonly exemptFromApproval: boolean;
  readonly requiresReadConfirmation: boolean;
  readonly poll?: PollInsert;
  /** Đợt 2. Thiếu là `company`. */
  readonly visibility?: SocialPostVisibility;
  /** Đợt 2. Phòng ban của tác giả; bắt buộc khi `visibility = 'unit'`. */
  readonly authorUnitId?: string;
  /** Đợt 2. Danh sách chia sẻ; chỉ ghi khi `visibility = 'custom'`. */
  readonly audience?: PostAudienceWrite;
  readonly commentsDisabled?: boolean;
  readonly groupTopicId?: string;
  readonly events: readonly SocialOutboxEvent[];
}

export interface PublishingPostPatch {
  /** Trạng thái bài lúc đọc; cập nhật chỉ áp khi bài vẫn ở trạng thái này. */
  readonly expectedStatus: SocialPostStatus;
  readonly title?: string | null;
  readonly bodyHtml?: string;
  readonly topicId?: string | null;
  readonly mentionUserIds?: readonly string[];
  readonly attachmentIds?: readonly string[];
  readonly uploaderId: string;
  /** Đổi giờ hẹn (bài `scheduled`). */
  readonly scheduledAt?: string;
  readonly requiresReadConfirmation?: boolean;
  /** `null` là bỏ hạn đóng. */
  readonly pollClosesAt?: string | null;
  /** Tác giả sửa bài bị từ chối: gửi lại duyệt hoặc đăng luôn. */
  readonly resubmitAs?: 'pending' | 'published';
  /** Đợt 2. Đổi quyền xem (không tính là "đã sửa": không đặt `edited_at`, không tạo bản lịch sử). */
  readonly visibility?: SocialPostVisibility;
  /** Đợt 2. `null` xoá phòng ban của tác giả (khi rời quyền `unit`). */
  readonly authorUnitId?: string | null;
  /** Đợt 2. Thay toàn bộ danh sách chia sẻ; rỗng cả hai mảng là xoá (khi rời quyền `custom`). */
  readonly audience?: PostAudienceWrite;
  readonly commentsDisabled?: boolean;
  /** Đợt 2. `null` bỏ chủ đề nhóm. */
  readonly groupTopicId?: string | null;
  /**
   * Đợt 2. Người sửa. Khi bài `published` và `title`/`bodyHtml` thực sự khác bản trong DB, store lưu bản
   * hiện tại vào `post_edits` NGAY TRƯỚC khi ghi đè (cùng transaction), tăng `edit_count`, giữ 50 bản gần nhất.
   */
  readonly editorId?: string;
  readonly events: readonly SocialOutboxEvent[];
}

export interface PostTransition {
  readonly from: readonly SocialPostStatus[];
  readonly to: 'published' | 'pending' | 'rejected';
  readonly moderatedBy?: string;
  readonly rejectReason?: string;
  readonly events: readonly SocialOutboxEvent[];
}

export interface DueDecision {
  /** `deleted`: bài không còn đăng được (nhóm đã xoá, tác giả đã rời nhóm). */
  readonly to: 'published' | 'pending' | 'deleted';
  readonly events: readonly SocialOutboxEvent[];
}

export interface PageCursor {
  readonly at: string;
  readonly id: string;
}

export interface PostListQuery {
  readonly limit: number;
  readonly cursor?: PageCursor;
}

export interface BookmarkedPostRow {
  readonly post: ExtendedPostRow;
  readonly bookmarkedAt: string;
}

export interface PollVoterRow {
  readonly userId: string;
  readonly optionId: string;
  readonly votedAt: string;
}

export interface ReadConfirmationRecord {
  readonly userId: string;
  readonly confirmedAt: string;
}

export interface InboxCountsRow {
  readonly myPending: number;
  readonly myScheduled: number;
  readonly myRejected: number;
  readonly toModerate: number;
  readonly bookmarks: number;
}

/**
 * Cổng dữ liệu của đường ghi bài. Khác `SocialStore` của P1: đọc bài ở mọi trạng thái trừ
 * `deleted` (kèm cột nhóm, hẹn giờ, duyệt) bằng `ExtendedPostRow`; mọi thao tác ghi nhận `events`
 * thì ghi chúng vào outbox trong cùng transaction.
 *
 * Danh sách trả cho người dùng nhận `scope` và áp luật nhìn thấy của `postVisibilitySql`.
 */
export interface SocialPublishingStore {
  /**
   * Bài ở mọi trạng thái trừ `deleted`, kể cả bài của nhóm đã xoá (người gọi tự kiểm quyền nhìn). Bài
   * `custom` kèm danh sách chia sẻ để kiểm quyền xem.
   */
  findForWrite(tenantId: string, postId: string): Promise<WritablePostRow | undefined>;
  /** Người được nhắc trong bài. */
  mentionsOf(tenantId: string, postId: string): Promise<readonly string[]>;

  insert(tenantId: string, input: PublishingPostInsert): Promise<void>;
  /** Ném `SocialPostStateError` khi bài đã đổi trạng thái; `SocialAttachmentUnavailableError` khi tệp không gắn được. */
  update(tenantId: string, postId: string, patch: PublishingPostPatch): Promise<void>;
  /** Chuyển trạng thái có điều kiện; ném `SocialPostStateError` khi trạng thái hiện tại không nằm trong `from`. */
  transition(tenantId: string, postId: string, transition: PostTransition): Promise<void>;
  /** Xoá mềm bài ở mọi trạng thái trừ `deleted`; ném `SocialPostNotFoundError` nếu không còn. */
  softDelete(tenantId: string, postId: string, userId: string, events: readonly SocialOutboxEvent[]): Promise<void>;
  /** Chỉ bài `published`; ném `SocialPostStateError` nếu bài đã đổi. */
  setPinned(
    tenantId: string,
    postId: string,
    pinned: boolean,
    events: readonly SocialOutboxEvent[],
  ): Promise<void>;

  /**
   * Lấy một bài `scheduled` đến hạn (`FOR UPDATE SKIP LOCKED`), cho `decide` quyết định rồi ghi kết quả
   * và sự kiện trong cùng transaction. Trả `undefined` khi không còn bài đến hạn (ngoài `excludeIds`).
   * `decide` ném lỗi thì transaction huỷ và lỗi được ném tiếp.
   */
  publishNextDue(
    tenantId: string,
    now: string,
    excludeIds: readonly string[],
    decide: (post: ExtendedPostRow) => Promise<DueDecision>,
  ): Promise<{ readonly postId: string; readonly outcome: DueDecision['to'] } | undefined>;

  /** Bài của tác giả theo trạng thái chưa đăng, mới nhất trước theo `(publishedAt, id)`. */
  listByAuthor(
    tenantId: string,
    authorId: string,
    status: 'pending' | 'scheduled' | 'rejected',
    scope: PostVisibilityScope,
    query: PostListQuery,
  ): Promise<ExtendedPostRow[]>;
  /** Bài Tường công ty `pending`, cũ nhất trước (con trỏ theo `(publishedAt, id)` tăng dần). */
  listPending(tenantId: string, scope: PostVisibilityScope, query: PostListQuery): Promise<ExtendedPostRow[]>;
  counts(tenantId: string, userId: string, canModerate: boolean, scope: PostVisibilityScope): Promise<InboxCountsRow>;

  /**
   * Bình chọn, xác nhận đã đọc, đã lưu của người xem cho một nhóm bài. `audiences` chỉ có mục cho bài
   * `custom` mà NGƯỜI XEM là tác giả (để dựng `SocialPost.audience`).
   */
  engagement(tenantId: string, postIds: readonly string[], viewerId: string): Promise<PostEngagementRelations>;

  /** Bỏ phiếu cũ, ghi phiếu mới (rỗng là bỏ phiếu). Ném `SocialPollClosedError` nếu đã đóng. */
  vote(
    tenantId: string,
    input: {
      readonly postId: string;
      readonly pollId: string;
      readonly userId: string;
      readonly optionIds: readonly string[];
      readonly events: readonly SocialOutboxEvent[];
    },
  ): Promise<void>;
  /** Đóng sớm; ném `SocialPollClosedError` nếu đã đóng thủ công. */
  closePoll(
    tenantId: string,
    pollId: string,
    userId: string,
    events: readonly SocialOutboxEvent[],
  ): Promise<void>;
  /** Người bỏ phiếu (chỉ gọi cho bình chọn công khai), theo `(votedAt, userId, optionId)`. */
  listVoters(
    tenantId: string,
    pollId: string,
    optionId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<PollVoterRow[]>;

  /** Idempotent. */
  confirmRead(tenantId: string, postId: string, userId: string): Promise<void>;
  /** Mọi xác nhận của bài, theo `(confirmedAt, userId)`. */
  listConfirmations(tenantId: string, postId: string): Promise<ReadConfirmationRecord[]>;

  setBookmark(tenantId: string, postId: string, userId: string, bookmarked: boolean): Promise<void>;
  /** Bài đã lưu còn thấy được, lưu gần nhất trước; con trỏ theo `(bookmarkedAt, postId)`. */
  listBookmarks(
    tenantId: string,
    userId: string,
    scope: PostVisibilityScope,
    query: PostListQuery,
  ): Promise<BookmarkedPostRow[]>;

  /** Đặt/bỏ/đổi phản ứng và ghi sự kiện cùng transaction (`SocialStore.reactions` không nhận sự kiện). */
  setReaction(
    tenantId: string,
    input: {
      readonly postId: string;
      readonly userId: string;
      readonly type: SocialReactionType | null;
      readonly events: readonly SocialOutboxEvent[];
    },
  ): Promise<void>;
}
