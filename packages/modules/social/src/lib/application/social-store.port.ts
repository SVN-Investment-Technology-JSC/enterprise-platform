import type {
  SocialAttachmentPurpose,
  SocialMediaLayout,
  SocialPostKind,
  SocialReactionType,
  SocialVideoProcessingStatus,
} from '@enterprise-platform/contracts-social';

/** Token DI của store. */
export const SOCIAL_STORE = Symbol('SOCIAL_STORE');

/**
 * Sự kiện ghi vào outbox cùng transaction với thay đổi dữ liệu. Store bọc
 * thành envelope (id, tenantId, source `social`, occurredAt) rồi insert vào
 * `integration_schema.outbox_events`.
 */
export interface SocialOutboxEvent {
  readonly type: string;
  readonly aggregateType: 'social-post' | 'social-comment' | 'social-attachment';
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Thời điểm là chuỗi ISO UTC giữ micro giây của Postgres (cần cho con trỏ phân trang). */
export interface PostRow {
  readonly id: string;
  readonly authorId: string;
  readonly kind: SocialPostKind;
  readonly title?: string;
  readonly bodyHtml: string;
  readonly topicId?: string;
  readonly topicName?: string;
  readonly pinned: boolean;
  readonly mentionsAll: boolean;
  /** Cách xếp ảnh và video (`posts.media_layout`); thiếu là `auto`. */
  readonly mediaLayout?: SocialMediaLayout;
  readonly publishedAt: string;
  readonly editedAt?: string;
  /** Bình luận chưa xoá, mọi cấp. */
  readonly commentCount: number;
}

export interface AttachmentRow {
  readonly id: string;
  readonly postId?: string;
  readonly commentId?: string;
  readonly uploadedBy: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly completed: boolean;
  /** Nơi tệp được tải lên để gắn vào. */
  readonly purpose: SocialAttachmentPurpose;
  /** `none`: không cần xử lý (không phải video, hoặc video cũ phát được ngay). */
  readonly processingStatus: 'none' | SocialVideoProcessingStatus;
  readonly processingError?: string;
  /** Khoá bản gốc còn chờ xoá sau chuyển mã. */
  readonly sourceKey?: string;
  readonly posterKey?: string;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface ReactionSummaryRow {
  readonly counts: Readonly<Partial<Record<SocialReactionType, number>>>;
  readonly total: number;
  readonly mine?: SocialReactionType;
}

export interface PostRelations {
  readonly mentions: ReadonlyMap<string, readonly string[]>;
  /** Chỉ tệp đã tải xong. */
  readonly attachments: ReadonlyMap<string, readonly AttachmentRow[]>;
  readonly reactions: ReadonlyMap<string, ReactionSummaryRow>;
}

export interface FeedFilter {
  readonly topicId?: string;
  readonly kind?: SocialPostKind;
  readonly authorId?: string;
}

export interface FeedQuery extends FeedFilter {
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface PostInsert {
  readonly id: string;
  readonly authorId: string;
  readonly kind: SocialPostKind;
  readonly title?: string;
  readonly bodyHtml: string;
  readonly topicId?: string;
  readonly pinned: boolean;
  readonly mentionsAll: boolean;
  /** Thiếu là `auto`. */
  readonly mediaLayout?: SocialMediaLayout;
  readonly mentionUserIds: readonly string[];
  /** Thứ tự mảng là thứ tự hiển thị (`attachments.position`). */
  readonly attachmentIds: readonly string[];
  /** Người tải các tệp (tác giả); store chỉ gắn tệp của người này. */
  readonly uploaderId: string;
  readonly events: readonly SocialOutboxEvent[];
}

export interface PostPatch {
  /** `null` là xoá tiêu đề. */
  readonly title?: string | null;
  readonly bodyHtml?: string;
  /** `null` là bỏ chuyên mục. */
  readonly topicId?: string | null;
  /** Có mặt nghĩa là thay toàn bộ. */
  readonly mentionUserIds?: readonly string[];
  /** Có mặt nghĩa là thay toàn bộ và thứ tự mảng là thứ tự hiển thị; tệp bị gỡ thành tệp mồ côi. */
  readonly attachmentIds?: readonly string[];
  /** Thiếu là giữ nguyên. */
  readonly mediaLayout?: SocialMediaLayout;
  /** Người sửa; store chỉ gắn thêm tệp chưa gắn bài của người này. */
  readonly uploaderId: string;
  readonly events: readonly SocialOutboxEvent[];
}

export interface CommentRow {
  readonly id: string;
  readonly postId: string;
  readonly parentId?: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt?: string;
  readonly deleted: boolean;
  /** Trả lời chưa xoá của bình luận gốc. */
  readonly replyCount: number;
}

export interface CommentInsert {
  readonly id: string;
  readonly postId: string;
  readonly parentId?: string;
  readonly authorId: string;
  readonly body: string;
  readonly mentionUserIds: readonly string[];
  /** Tệp đã tải xong gắn cùng giao dịch; thiếu tệp hợp lệ là lỗi cả thao tác. */
  readonly attachmentIds?: readonly string[];
  readonly events: readonly SocialOutboxEvent[];
}

export interface CommentListQuery {
  readonly postId: string;
  /** Có `parentId` thì liệt kê trả lời của bình luận đó, không thì liệt kê bình luận gốc. */
  readonly parentId?: string;
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

export interface TopicRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly postCount: number;
}

export interface AttachmentInsert {
  readonly id: string;
  readonly uploadedBy: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly purpose: SocialAttachmentPurpose;
}

export interface ReactorRow {
  readonly userId: string;
  readonly type: SocialReactionType;
  readonly reactedAt: string;
}

export interface OrphanAttachment {
  readonly id: string;
  readonly storageKey: string;
  readonly posterKey?: string;
  readonly sourceKey?: string;
  /** Đã tải xong chưa; `false` thì có thể còn phần tải nhiều phần dang dở cần huỷ. */
  readonly completed?: boolean;
}

/**
 * Cổng dữ liệu của phân hệ. Mọi phương thức nhận `tenantId` đầu tiên; hiện thực
 * Postgres chọn DB của tenant theo đó.
 *
 * Mọi hàm ghi nhận `events` thì phải ghi chúng vào outbox trong cùng
 * transaction với thay đổi dữ liệu.
 */
export interface SocialStore {
  readonly posts: {
    /** Bài ghim (bài đã đăng), mới nhất trước, theo bộ lọc; tối đa `limit`. */
    pinned(tenantId: string, filter: FeedFilter, limit: number): Promise<PostRow[]>;
    /** Bài đã đăng, không ghim, `(publishedAt, id)` giảm dần; lấy tối đa `query.limit` dòng. */
    feed(tenantId: string, query: FeedQuery): Promise<PostRow[]>;
    /** Bài đã đăng (chưa xoá). */
    findById(tenantId: string, postId: string): Promise<PostRow | undefined>;
    relations(tenantId: string, postIds: readonly string[], viewerId: string): Promise<PostRelations>;
    insert(tenantId: string, input: PostInsert): Promise<void>;
    /** Ném `SocialAttachmentUnavailableError` khi có tệp không gắn được. */
    update(tenantId: string, postId: string, patch: PostPatch): Promise<void>;
    softDelete(tenantId: string, postId: string, userId: string): Promise<void>;
    setPinned(tenantId: string, postId: string, pinned: boolean): Promise<void>;
  };

  readonly reactions: {
    set(tenantId: string, postId: string, userId: string, type: SocialReactionType): Promise<void>;
    remove(tenantId: string, postId: string, userId: string): Promise<void>;
    summary(tenantId: string, postId: string, viewerId: string): Promise<ReactionSummaryRow>;
    list(tenantId: string, postId: string, limit: number): Promise<ReactorRow[]>;
  };

  readonly comments: {
    /** Cả bình luận đã xoá mềm, để kiểm cấp và quyền. */
    findById(tenantId: string, commentId: string): Promise<CommentRow | undefined>;
    list(tenantId: string, query: CommentListQuery): Promise<CommentRow[]>;
    mentions(
      tenantId: string,
      commentIds: readonly string[],
    ): Promise<ReadonlyMap<string, readonly string[]>>;
    insert(tenantId: string, input: CommentInsert): Promise<void>;
    update(
      tenantId: string,
      commentId: string,
      patch: {
        readonly body: string;
        readonly mentionUserIds: readonly string[];
        /** Gắn thêm các tệp này (không gỡ tệp cũ; gỡ qua `SocialCommentAttachmentStore.detach`). */
        readonly attachmentIds?: readonly string[];
        readonly uploaderId?: string;
        readonly events: readonly SocialOutboxEvent[];
      },
    ): Promise<void>;
    softDelete(tenantId: string, commentId: string, userId: string): Promise<void>;
  };

  readonly topics: {
    list(tenantId: string, includeInactive: boolean): Promise<TopicRow[]>;
    findById(tenantId: string, topicId: string): Promise<TopicRow | undefined>;
    /** Ném `SocialTopicNameTakenError` khi trùng tên (không phân biệt hoa thường). */
    insert(tenantId: string, input: { id: string; name: string; createdBy: string }): Promise<void>;
    update(
      tenantId: string,
      topicId: string,
      patch: { readonly name?: string; readonly isActive?: boolean },
    ): Promise<void>;
  };

  readonly attachments: {
    insert(tenantId: string, input: AttachmentInsert): Promise<void>;
    findById(tenantId: string, attachmentId: string): Promise<AttachmentRow | undefined>;
    markCompleted(tenantId: string, attachmentId: string, sizeBytes: number): Promise<void>;
    /** Tệp chưa gắn bài, tạo trước `olderThan` (ISO). */
    listOrphans(tenantId: string, olderThan: string, limit: number): Promise<OrphanAttachment[]>;
    deleteByIds(tenantId: string, ids: readonly string[]): Promise<void>;
    /** Mọi tệp của một bài: tệp gắn vào bài và tệp của các bình luận của bài (mọi trạng thái, kể cả video đang xử lý). */
    listForPost(tenantId: string, postId: string): Promise<OrphanAttachment[]>;
    /** Xoá dòng bất kể đã gắn hay chưa. Chỉ dành cho việc xoá bài (khác `deleteByIds`, chỉ xoá tệp chưa gắn). */
    deleteAttachedByIds(tenantId: string, ids: readonly string[]): Promise<void>;
    /** Số lần tải dang dở của người dùng: chưa hoàn tất, chưa gắn bài/bình luận, tạo từ `sinceIso` (ISO). */
    countPending(tenantId: string, uploaderId: string, sinceIso: string): Promise<number>;
  };
}
