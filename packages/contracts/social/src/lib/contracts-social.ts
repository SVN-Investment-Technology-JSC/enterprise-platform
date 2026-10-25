/**
 * Hợp đồng dữ liệu của phân hệ Mạng nội bộ (social).
 *
 * P1: bảng tin và tường công ty — bài viết (nội dung rich text đã làm sạch, ảnh/tệp
 * đính kèm), chuyên mục, ghim, phản ứng, bình luận lồng hai cấp, mention.
 *
 * P2/P3 (thêm, không đổi kiểu của P1): nhóm, bình chọn, xác nhận đã đọc, duyệt bài, hẹn giờ,
 * bài đã lưu, bài tự sinh, trang cá nhân, tìm kiếm, sinh nhật, realtime. Kiểu của nhóm nằm ở
 * `contracts-social-groups.ts`, của hồ sơ/tìm kiếm/realtime ở `contracts-social-discovery.ts`;
 * mọi thứ xuất qua `index.ts`. Hợp đồng API: docs/architecture/social-p2-p3-api.md.
 *
 * Quyền: Mạng nội bộ mở cho mọi thành viên tenant; chỉ `social.post.moderate` và
 * `social.manage` (kèm quản trị tenant) còn là quyền. Quản trị nhóm là vai trò admin của nhóm.
 */

import type {
  SocialPostAudience,
  SocialPostAudienceInput,
  SocialPostVisibility,
} from './contracts-social-visibility.js';

export const SOCIAL_MODULE_KEY = 'social';
export const SOCIAL_LAUNCH_URL = '/modules/social';

/** Quyền của phân hệ, khai trong danh mục quyền của tenant. */
export const SOCIAL_PERMISSIONS = [
  /** Xem bảng tin, bài viết, bình luận. */
  'social.read',
  /** Đăng bài, bình luận, bày tỏ phản ứng; sửa/xoá nội dung của chính mình. */
  'social.post.write',
  /** Sửa/xoá bài và bình luận của người khác, ghim bài, dùng @all. */
  'social.post.moderate',
  /** Quản lý chuyên mục. */
  'social.manage',
] as const;
export type SocialPermission = (typeof SOCIAL_PERMISSIONS)[number];

export const SOCIAL_POST_KINDS = ['post', 'announcement'] as const;
export type SocialPostKind = (typeof SOCIAL_POST_KINDS)[number];

export const SOCIAL_POST_KIND_LABELS: Readonly<Record<SocialPostKind, string>> = {
  post: 'Bài viết',
  announcement: 'Thông báo',
};

/** Loại phản ứng. Giao diện hiển thị bằng biểu tượng, không dùng emoji. */
export const SOCIAL_REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry', 'celebrate', 'insightful'] as const;
export type SocialReactionType = (typeof SOCIAL_REACTION_TYPES)[number];

export const SOCIAL_REACTION_LABELS: Readonly<Record<SocialReactionType, string>> = {
  like: 'Thích',
  love: 'Yêu thích',
  haha: 'Haha',
  wow: 'Wow',
  sad: 'Buồn',
  angry: 'Phẫn nộ',
  celebrate: 'Chúc mừng',
  insightful: 'Hữu ích',
};

export const SOCIAL_POST_TITLE_MAX = 200;
/** Độ dài tối đa của nội dung HTML đã làm sạch. */
export const SOCIAL_POST_BODY_MAX = 50_000;
export const SOCIAL_COMMENT_MAX = 4_000;
export const SOCIAL_MAX_ATTACHMENTS_PER_POST = 10;
export const SOCIAL_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const SOCIAL_PRESIGNED_URL_TTL_SECONDS = 300;

/** Bình luận: số tệp tối đa, dung lượng ảnh tối đa và số bình luận mỗi lần tải (nhẹ vì bình luận có thể kèm ảnh). */
export const SOCIAL_COMMENT_MAX_ATTACHMENTS = 4;
export const SOCIAL_COMMENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SOCIAL_COMMENT_PAGE_SIZE = 10;
/** Cạnh ảnh lớn nhất được ghi nhận kích thước (đủ cho ảnh panorama, loại giá trị vô lý). */
export const SOCIAL_IMAGE_MAX_DIMENSION = 20_000;

/**
 * Video: nhận mp4, webm và mov (iPhone), chuyển mã ở nền sang MP4 H.264 rồi xoá bản gốc. Giới hạn theo nơi gắn:
 * dung lượng tải lên, thời lượng, chiều cao đầu ra (không bao giờ phóng to), bitrate hình tối đa và số video.
 */
export const SOCIAL_VIDEO_CONTENT_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/quicktime'];

export interface SocialVideoLimits {
  readonly maxBytes: number;
  readonly maxSeconds: number;
  /** Cạnh NGẮN đầu ra tối đa (720 là 720p cho cả video ngang lẫn dọc); video nhỏ hơn giữ nguyên, không phóng to. */
  readonly maxHeight: number;
  readonly maxVideoKbps: number;
  readonly maxVideos: number;
}

export const SOCIAL_VIDEO_LIMITS: Readonly<Record<SocialAttachmentPurpose, SocialVideoLimits>> = {
  comment: { maxBytes: 300 * 1024 * 1024, maxSeconds: 180, maxHeight: 720, maxVideoKbps: 2500, maxVideos: 1 },
  post: { maxBytes: 1024 * 1024 * 1024, maxSeconds: 600, maxHeight: 1080, maxVideoKbps: 4000, maxVideos: 3 },
};
export const SOCIAL_COMMENT_VIDEO_MAX_BYTES = SOCIAL_VIDEO_LIMITS.comment.maxBytes;
export const SOCIAL_COMMENT_MAX_VIDEOS = SOCIAL_VIDEO_LIMITS.comment.maxVideos;

/** Tổng dung lượng tệp chưa gắn vào bài/bình luận của một người (đang tải, hoặc đã tải xong mà chưa gửi). */
export const SOCIAL_MAX_UNATTACHED_BYTES_PER_USER = 2 * 1024 * 1024 * 1024;
/** Video đang chờ hoặc đang chuyển mã: trần mỗi người và mỗi tenant, để một bên đăng hàng loạt không chiếm hết worker. */
export const SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_USER = 3;
export const SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_TENANT = 6;
/** Thời gian chạy ffmpeg tối đa cho một video (RabbitMQ chờ ack 30 phút, nên phải thấp hơn). */
export const SOCIAL_VIDEO_MAX_PROCESSING_SECONDS = 20 * 60;
/** Video đã đăng mà quá chừng này chưa xử lý xong (hàng chờ hoặc worker treo) thì xếp lại hàng. */
export const SOCIAL_VIDEO_REQUEUE_AFTER_SECONDS = 10 * 60;
/** Video quá chừng này mà CHƯA TỪNG được worker nhận thì báo lỗi (hệ thống xử lý video không chạy). */
export const SOCIAL_VIDEO_QUEUE_TIMEOUT_SECONDS = 30 * 60;

export const SOCIAL_VIDEO_PROCESSING_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;
export type SocialVideoProcessingStatus = (typeof SOCIAL_VIDEO_PROCESSING_STATUSES)[number];

/**
 * Yêu cầu chuyển mã đi qua outbox rồi RabbitMQ; mỗi nơi gắn một hàng đợi riêng (mỗi hàng một luồng) để video
 * bình luận ngắn không phải chờ sau video bài viết dài. Không đổi tên sau khi đã phát (skill erp-events).
 * Cố ý tách khỏi `SOCIAL_EVENT_TYPES`: đây là việc nền, không phải sự kiện thông báo hay realtime.
 */
export const SOCIAL_VIDEO_EVENT_TYPES = {
  comment: 'social.video.comment_requested',
  post: 'social.video.post_requested',
} as const;
export const SOCIAL_VIDEO_QUEUES = {
  comment: 'social.video.comment.v1',
  post: 'social.video.post.v1',
} as const;

/**
 * Cách xếp ảnh và video của một bài viết. `auto` giữ cách hiển thị cũ (ảnh dạng lưới, video xếp dọc phía dưới) nên
 * bài cũ không đổi. Thứ tự các mục là thứ tự của `attachmentIds` khi đăng hoặc sửa bài.
 */
export const SOCIAL_MEDIA_LAYOUTS = ['auto', 'grid', 'featured', 'stack', 'carousel'] as const;
export type SocialMediaLayout = (typeof SOCIAL_MEDIA_LAYOUTS)[number];
export const SOCIAL_MEDIA_LAYOUT_DEFAULT: SocialMediaLayout = 'auto';
export const SOCIAL_MEDIA_LAYOUT_LABELS: Readonly<Record<SocialMediaLayout, string>> = {
  auto: 'Tự động',
  grid: 'Lưới đều',
  featured: 'Nổi bật',
  stack: 'Xếp dọc',
  carousel: 'Trượt ngang',
};

/** `payload` của yêu cầu chuyển mã (tenantId nằm ở envelope). */
export interface SocialVideoRequestedPayload {
  readonly attachmentId: string;
  readonly purpose: SocialAttachmentPurpose;
}
/** URL xem video sống lâu hơn URL ảnh vì video phát và tua lâu. */
export const SOCIAL_VIDEO_URL_TTL_SECONDS = 3600;
export const SOCIAL_FEED_PAGE_SIZE = 10;
/** Số chuyên mục tối đa của một bài. */
export const SOCIAL_POST_TOPICS_MAX = 5;
export const SOCIAL_FEED_MAX_PAGE_SIZE = 50;
export const SOCIAL_TOPIC_NAME_MAX = 80;

/** Kiểu tệp được nhận. Danh sách trắng. */
export const SOCIAL_ALLOWED_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/** Tệp ảnh thì hiển thị thẳng trong bài. */
export const SOCIAL_IMAGE_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export interface SocialUserRef {
  readonly id: string;
  readonly name: string;
  readonly position?: string;
  readonly unitName?: string;
  readonly avatarUrl?: string;
}

export interface SocialTopic {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly postCount: number;
}

export interface SocialAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly isImage: boolean;
  /** Video (mp4, webm, mov). Thiếu nghĩa là không phải video. */
  readonly isVideo?: boolean;
  /** Chỉ video: trạng thái chuyển mã. Video cũ và video đã xong đều là `ready`. Chỉ `ready` mới gắn được vào bài/bình luận. */
  readonly processingStatus?: SocialVideoProcessingStatus;
  /** Lý do chuyển mã thất bại (tiếng Việt), chỉ khi `failed`. */
  readonly processingError?: string;
  /** URL ký sẵn của ảnh poster (chỉ video đã chuyển mã). */
  readonly posterUrl?: string;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  /** URL ký sẵn để xem/tải; chỉ có khi đọc bài. */
  readonly url?: string;
}

export interface SocialPost {
  readonly id: string;
  readonly author: SocialUserRef;
  readonly kind: SocialPostKind;
  readonly title?: string;
  /** HTML đã làm sạch ở server; hiển thị trực tiếp. */
  readonly bodyHtml: string;
  /** Chuyên mục chính (phần tử đầu của `topics`); giữ cho bản cũ. */
  readonly topic?: { readonly id: string; readonly name: string };
  /** Mọi chuyên mục của bài theo thứ tự tác giả chọn; thiếu hoặc rỗng là không có. */
  readonly topics?: readonly { readonly id: string; readonly name: string }[];
  readonly pinned: boolean;
  readonly attachments: readonly SocialAttachment[];
  readonly mentions: readonly SocialUserRef[];
  readonly mentionsAll: boolean;
  readonly reactionCounts: Readonly<Partial<Record<SocialReactionType, number>>>;
  readonly reactionTotal: number;
  readonly myReaction?: SocialReactionType;
  readonly commentCount: number;
  readonly publishedAt: string;
  readonly editedAt?: string;
  /** Người đang xem có sửa/xoá/ghim được bài này không. */
  readonly capabilities: SocialPostCapabilities;

  /* ---- P2/P3: các trường dưới đây có thể thiếu; mặc định ghi cạnh từng trường. ---- */

  /** Mặc định `published`. Bài `pending|scheduled|rejected` chỉ tác giả và moderator thấy. */
  readonly status?: SocialPostStatus;
  /** Cách xếp ảnh và video; thiếu nghĩa là `auto`. `attachments` đã được sắp theo thứ tự tác giả chọn. */
  readonly mediaLayout?: SocialMediaLayout;
  /** Có mặt khi bài thuộc một nhóm; thiếu nghĩa là bài trên Tường công ty. */
  readonly group?: SocialGroupRef;
  readonly poll?: SocialPoll;
  /** Có mặt khi bài yêu cầu xác nhận đã đọc. */
  readonly readConfirmation?: SocialReadConfirmationSummary;
  /** Giờ hẹn đăng; chỉ có khi `status = 'scheduled'`. */
  readonly scheduledAt?: string;
  /** Lý do từ chối; chỉ có khi `status = 'rejected'` và người xem là tác giả hoặc moderator. */
  readonly rejectReason?: string;
  /** Người duyệt/từ chối và thời điểm; chỉ có cho tác giả và moderator. */
  readonly moderatedBy?: SocialUserRef;
  readonly moderatedAt?: string;
  /** Mặc định `false`. */
  readonly bookmarked?: boolean;
  /**
   * Bài tự sinh từ hoạt động. Với bài này `kind` luôn là `post` (kiểu `SocialPostKind` không đổi để
   * không vỡ mã P1), `bodyHtml` rỗng và không sửa được; hiển thị theo `activity.type`.
   */
  readonly activity?: SocialPostActivity;

  /* ---- Đợt 2: quyền xem, tắt bình luận, lịch sử sửa, chủ đề nhóm ---- */

  /** Quyền xem của bài Tường công ty. Mặc định `company`; bài nhóm luôn `company` (theo nhóm). */
  readonly visibility?: SocialPostVisibility;
  /**
   * Danh sách người/phòng ban được chọn khi `visibility = 'custom'`. Chỉ có cho tác giả (và người
   * có `capabilities.canChangeVisibility`); người khác không thấy ai được chia sẻ.
   */
  readonly audience?: SocialPostAudience;
  /** Đã tắt bình luận. Bình luận cũ vẫn đọc được. Mặc định `false`. */
  readonly commentsDisabled?: boolean;
  /** Số lần đã sửa tiêu đề/nội dung (số bản cũ trong lịch sử). Mặc định 0. */
  readonly editCount?: number;
  /** Chủ đề của nhóm mà bài thuộc về (chỉ bài nhóm). Khác với `topic` của Tường công ty. */
  readonly groupTopic?: { readonly id: string; readonly name: string };
}

export interface SocialPostCapabilities {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canPin: boolean;
  readonly canComment: boolean;
  /* Mặc định `false` cho các cờ dưới đây. */
  /** Duyệt/từ chối bài `pending` (moderator). */
  readonly canModerate?: boolean;
  /** Xem danh sách đã/chưa xác nhận đã đọc (tác giả, moderator, admin nhóm). */
  readonly canViewReadConfirmations?: boolean;
  /** Đăng ngay bài `scheduled` (tác giả). */
  readonly canPublishNow?: boolean;
  /** Đổi giờ hẹn bài `scheduled` (tác giả). */
  readonly canReschedule?: boolean;
  /** Đóng sớm bình chọn (tác giả, moderator). */
  readonly canClosePoll?: boolean;
  /** Đợt 2. Xem lịch sử chỉnh sửa: tác giả, moderator, admin nhóm (bài nhóm); chỉ khi `editCount > 0`. */
  readonly canViewHistory?: boolean;
  /** Đợt 2. Bật/tắt bình luận: tác giả, moderator, admin nhóm. */
  readonly canToggleComments?: boolean;
  /** Đợt 2. Đổi quyền xem: tác giả; chỉ bài Tường công ty đã đăng hoặc hẹn giờ. */
  readonly canChangeVisibility?: boolean;
  /** Đợt 2. Báo cáo bài: mọi người xem được bài trừ tác giả. */
  readonly canReport?: boolean;
}

export interface SocialFeedPage {
  readonly items: readonly SocialPost[];
  /** Con trỏ cho trang kế tiếp; thiếu nghĩa là hết. */
  readonly nextCursor?: string;
}

export interface SocialFeedQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly topicId?: string;
  readonly kind?: SocialPostKind;
  readonly authorId?: string;
  /**
   * Phạm vi bảng tin. Mặc định `wall` (Tường công ty: bài không thuộc nhóm, giống P1).
   * `groups`: bài của các nhóm tôi là thành viên. `all`: Tường công ty + bài của nhóm tôi thấy
   * được (dùng cho trang cá nhân, kèm `authorId`). Bị bỏ qua khi có `groupId`.
   */
  readonly scope?: SocialFeedSource;
  /** Bảng tin của một nhóm (cũng có `GET /groups/:id/feed`). */
  readonly groupId?: string;
  /** Đợt 2. Lọc theo chủ đề của nhóm; cần `groupId` (không có thì 400 `VALIDATION`). */
  readonly groupTopicId?: string;
}

export interface CreateSocialPostRequest {
  readonly kind?: SocialPostKind;
  readonly title?: string;
  readonly bodyHtml: string;
  /** Một chuyên mục (cách cũ); `topicIds` được ưu tiên khi có cả hai. */
  readonly topicId?: string;
  /** Các chuyên mục của bài (tối đa `SOCIAL_POST_TOPICS_MAX`); bài nhóm không có chuyên mục. */
  readonly topicIds?: readonly string[];
  /** Thứ tự của mảng là thứ tự hiển thị của ảnh và video. */
  readonly attachmentIds?: readonly string[];
  /** Cách xếp ảnh và video; mặc định `auto`. */
  readonly mediaLayout?: SocialMediaLayout;
  readonly mentionUserIds?: readonly string[];
  /** Cần quyền `social.post.moderate`. */
  readonly mentionsAll?: boolean;
  /** Cần quyền `social.post.moderate` (hoặc admin nhóm khi có `groupId`). */
  readonly pinned?: boolean;
  /** Đăng vào nhóm; người đăng phải là thành viên. Bài nhóm không có `topicId`. */
  readonly groupId?: string;
  readonly poll?: CreateSocialPollRequest;
  readonly requiresReadConfirmation?: boolean;
  /**
   * ISO 8601; hẹn đăng (cách hiện tại ít nhất `SOCIAL_SCHEDULE_MIN_LEAD_SECONDS` giây, tối đa
   * `SOCIAL_SCHEDULE_MAX_DAYS` ngày). Có giá trị thì bài ở trạng thái `scheduled`.
   */
  readonly scheduledAt?: string;
  /**
   * Đợt 2. Quyền xem, chỉ cho bài Tường công ty (có `groupId` thì phải thiếu hoặc `company`, nếu
   * không 400 `VISIBILITY_NOT_ALLOWED`). Mặc định `company`. `announcement`, `pinned`,
   * `mentionsAll`, `requiresReadConfirmation` chỉ đi với `company`.
   */
  readonly visibility?: SocialPostVisibility;
  /** Đợt 2. Bắt buộc có ít nhất một người hoặc phòng ban khi `visibility = 'custom'`; bị bỏ qua nếu khác. */
  readonly audience?: SocialPostAudienceInput;
  /** Đợt 2. Tắt bình luận ngay từ khi đăng. */
  readonly commentsDisabled?: boolean;
  /** Đợt 2. Chủ đề của nhóm (cần `groupId`; chủ đề phải thuộc nhóm đó). */
  readonly groupTopicId?: string;
}

export interface UpdateSocialPostRequest {
  readonly title?: string | null;
  readonly bodyHtml?: string;
  readonly topicId?: string | null;
  /** Thay toàn bộ chuyên mục của bài; mảng rỗng là bỏ hết. `topicIds` được ưu tiên khi có cả hai. */
  readonly topicIds?: readonly string[];
  /** Thứ tự của mảng là thứ tự hiển thị; gửi lại cùng tập tệp với thứ tự khác là đổi thứ tự. */
  readonly attachmentIds?: readonly string[];
  /** Đổi cách xếp ảnh và video; thiếu là giữ nguyên. */
  readonly mediaLayout?: SocialMediaLayout;
  readonly mentionUserIds?: readonly string[];
  /** Chỉ bài `scheduled`: đổi giờ hẹn (vẫn phải ở tương lai). */
  readonly scheduledAt?: string;
  /** Bật xác nhận đã đọc khi chưa ai xác nhận. Không tắt được sau khi đã có người xác nhận. */
  readonly requiresReadConfirmation?: boolean;
  /** Bình chọn đã tạo chỉ đổi được hạn đóng; lựa chọn cố định. */
  readonly poll?: UpdateSocialPollRequest;
  /** Đợt 2. Đổi quyền xem (chỉ tác giả; xem `canChangeVisibility`). Đổi không tính là "đã sửa". */
  readonly visibility?: SocialPostVisibility;
  /** Đợt 2. Thay toàn bộ danh sách chia sẻ khi `visibility = 'custom'` (kết quả cuối phải không rỗng). */
  readonly audience?: SocialPostAudienceInput;
  /** Đợt 2. Bật/tắt bình luận (tác giả, moderator, admin nhóm). Không tính là "đã sửa". */
  readonly commentsDisabled?: boolean;
  /** Đợt 2. Chuyển bài nhóm sang chủ đề khác; `null` để bỏ chủ đề. */
  readonly groupTopicId?: string | null;
}

export interface PinSocialPostRequest {
  readonly pinned: boolean;
}

export interface SetSocialReactionRequest {
  /** `null` để bỏ phản ứng. */
  readonly type: SocialReactionType | null;
}

export interface SocialReactionSummary {
  readonly reactionCounts: Readonly<Partial<Record<SocialReactionType, number>>>;
  readonly reactionTotal: number;
  readonly myReaction?: SocialReactionType;
}

export interface SocialReactor {
  readonly user: SocialUserRef;
  readonly type: SocialReactionType;
  readonly reactedAt: string;
}

export interface SocialComment {
  readonly id: string;
  readonly postId: string;
  /** Chỉ hai cấp: bình luận gốc và trả lời. */
  readonly parentId?: string;
  readonly author: SocialUserRef;
  /** Văn bản thuần; mention ghi dạng `@[userId]`. */
  readonly body: string;
  readonly mentions: readonly SocialUserRef[];
  readonly createdAt: string;
  readonly editedAt?: string;
  readonly deleted: boolean;
  readonly replyCount: number;
  /** Ảnh đính kèm (tối đa `SOCIAL_COMMENT_MAX_ATTACHMENTS`); rỗng khi bình luận đã xoá. */
  readonly attachments: readonly SocialAttachment[];
  readonly reactionCounts: Readonly<Partial<Record<SocialReactionType, number>>>;
  readonly reactionTotal: number;
  readonly myReaction?: SocialReactionType;
  readonly capabilities: { readonly canEdit: boolean; readonly canDelete: boolean };
}

export interface SocialCommentPage {
  readonly items: readonly SocialComment[];
  readonly nextCursor?: string;
}

export interface CreateSocialCommentRequest {
  /** Có thể rỗng khi bình luận có tệp đính kèm. */
  readonly body: string;
  readonly parentId?: string;
  readonly mentionUserIds?: readonly string[];
  /** Tệp đã tải xong (initiate + complete với `purpose: 'comment'`). */
  readonly attachmentIds?: readonly string[];
}

export interface UpdateSocialCommentRequest {
  readonly body: string;
  readonly mentionUserIds?: readonly string[];
  /** Danh sách tệp mong muốn sau khi sửa; thiếu là giữ nguyên, `[]` là gỡ hết. Tệp bị gỡ bị xoá khỏi kho ngay. */
  readonly attachmentIds?: readonly string[];
}

export interface CreateSocialTopicRequest {
  readonly name: string;
}

export interface UpdateSocialTopicRequest {
  readonly name?: string;
  readonly isActive?: boolean;
}

/** Bước 1 tải tệp: xin URL ký sẵn. Tệp mồ côi (chưa gắn bài) bị dọn sau 24 giờ. */
/** Nơi tệp sẽ được gắn: quyết định kiểu tệp và dung lượng được nhận (bình luận chỉ nhận ảnh nhỏ hơn). */
export type SocialAttachmentPurpose = 'post' | 'comment';

export interface InitiateSocialAttachmentRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Mặc định `post`. */
  readonly purpose?: SocialAttachmentPurpose;
}

/**
 * Tệp lớn hơn mức này tải theo từng phần (S3 multipart): mỗi phần tải lại riêng được khi mạng chập chờn,
 * và có thanh tiến trình chính xác. Tệp nhỏ hơn vẫn tải bằng một lệnh PUT.
 */
export const SOCIAL_MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
/** Cỡ mỗi phần (trừ phần cuối). S3 đòi tối thiểu 5 MB cho mọi phần trừ phần cuối. */
export const SOCIAL_MULTIPART_PART_BYTES = 8 * 1024 * 1024;

export interface SocialMultipartPart {
  readonly partNumber: number;
  /** URL ký sẵn để `PUT` đúng `sizeBytes` byte của phần này. */
  readonly url: string;
  readonly sizeBytes: number;
}

export interface SocialMultipartUpload {
  readonly uploadId: string;
  readonly parts: readonly SocialMultipartPart[];
}

export interface InitiateSocialAttachmentResponse {
  readonly attachmentId: string;
  /** URL `PUT` cho tệp nhỏ; chuỗi rỗng khi tải nhiều phần (xem `multipart`). */
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  /** Có khi tệp lớn hơn `SOCIAL_MULTIPART_THRESHOLD_BYTES`. */
  readonly multipart?: SocialMultipartUpload;
}

/** Body của `POST /attachments/:id/complete`: với tải nhiều phần phải gửi `uploadId` nhận được lúc initiate. */
export interface CompleteSocialAttachmentRequest {
  readonly uploadId?: string;
  /**
   * Chỉ ảnh: kích thước điểm ảnh (số nguyên dương, tối đa `SOCIAL_IMAGE_MAX_DIMENSION`) mà trình duyệt đọc được trước khi tải lên.
   * Server chỉ dùng để đặt tỉ lệ khung hiển thị (tránh giật bố cục và cắt ảnh); giá trị không hợp lệ bị bỏ qua, không gây lỗi.
   */
  readonly width?: number;
  readonly height?: number;
}

/**
 * Body của `POST /attachments/:id/parts`: xin lại URL ký cho vài phần. URL phần chỉ sống vài phút nên tệp lớn
 * trên mạng chậm, hoặc phần phải thử lại, cần URL mới thay vì URL cấp lúc `initiate`.
 */
export interface RefreshSocialUploadPartsRequest {
  readonly uploadId: string;
  readonly partNumbers: readonly number[];
}

export interface RefreshSocialUploadPartsResponse {
  readonly parts: readonly SocialMultipartPart[];
}

/** Body của `POST /attachments/:id/abort`: huỷ lần tải chưa hoàn tất (người dùng bấm huỷ), xoá dòng và dọn phần đã tải. */
export interface AbortSocialAttachmentRequest {
  readonly uploadId?: string;
}

/**
 * Body của `POST /attachments/:id/discard` (204): bỏ tệp của chính mình mà chưa gắn vào bài hay bình luận nào, ở
 * mọi trạng thái (đang tải, đã tải xong, đang chuyển mã, lỗi). Server từ chối nếu tệp đã gắn hoặc không phải của người gọi.
 * Giao diện gọi khi đóng tab hoặc rời ô soạn thảo.
 */
export interface DiscardSocialAttachmentRequest {
  readonly uploadId?: string;
}

/** Body của `POST /attachments/status`: trạng thái xử lý của tối đa 10 tệp do chính người gọi tải lên. */
export interface SocialAttachmentStatusRequest {
  readonly ids: readonly string[];
}

export interface SocialAttachmentStatusResponse {
  readonly items: readonly SocialAttachment[];
}

export interface SocialMe {
  readonly user: SocialUserRef;
  readonly permissions: readonly SocialPermission[];
}

/** Sự kiện phát qua outbox (skill erp-events). Không đổi tên sau khi đã phát. */
export const SOCIAL_EVENT_TYPES = {
  postPublished: 'social.post.published',
  commentCreated: 'social.comment.created',
  mentioned: 'social.mention.created',
  /** P2. Bài Tường công ty chờ duyệt vừa được gửi; thông báo cho moderator. */
  postPending: 'social.post.pending',
  /** P2. Moderator duyệt hoặc từ chối bài; thông báo cho tác giả. Duyệt xong còn phát `postPublished`. */
  postModerated: 'social.post.moderated',
  /** P2. Bài sửa/xoá/ghim (chỉ cho realtime, không tạo thông báo). */
  postChanged: 'social.post.changed',
  /** P2. Phản ứng đổi (chỉ cho realtime). */
  reactionChanged: 'social.reaction.changed',
  /** P2. Có phiếu mới, đổi phiếu hoặc đóng bình chọn (chỉ cho realtime). */
  pollChanged: 'social.poll.changed',
  /** P2. Người dùng được thêm vào nhóm bởi admin hoặc được duyệt yêu cầu. */
  groupMemberAdded: 'social.group.member.added',
  /** P2. Có yêu cầu tham gia nhóm riêng tư; thông báo cho admin nhóm. */
  groupJoinRequested: 'social.group.join.requested',
  /** P2. Yêu cầu tham gia được duyệt hoặc từ chối; thông báo cho người xin. */
  groupJoinDecided: 'social.group.join.decided',
  /** Đợt 2. Có báo cáo mới về nhóm/bài/bình luận; thông báo cho moderator hoặc admin nhóm. */
  reportCreated: 'social.report.created',
} as const;
export type SocialEventType = (typeof SOCIAL_EVENT_TYPES)[keyof typeof SOCIAL_EVENT_TYPES];

export interface SocialPostPublishedPayload {
  readonly postId: string;
  readonly authorId: string;
  readonly title?: string;
  readonly kind: SocialPostKind;
  readonly mentionsAll: boolean;
  readonly authorName: string;
  /** Người được nhắc trong bài; để không báo trùng với thông báo mention. */
  readonly mentionedUserIds?: readonly string[];
  /** P2: có mặt khi bài thuộc nhóm. */
  readonly groupId?: string;
  readonly groupName?: string;
  /**
   * P2: người nhận thông báo của bài nhóm (thành viên trừ tác giả, tối đa
   * `SOCIAL_NOTIFY_RECIPIENT_MAX`). Bài Tường công ty thì thiếu: người nhận tính theo `kind`,
   * `mentionsAll` và `requiresReadConfirmation` như P1.
   */
  readonly recipientUserIds?: readonly string[];
  /** P2: bài yêu cầu xác nhận đã đọc; thông báo nên nhắc việc này. */
  readonly requiresReadConfirmation?: boolean;
  /** P2: bài đăng ngay, vừa được duyệt, hoặc tới giờ hẹn. Thiếu là `direct`. */
  readonly origin?: 'direct' | 'approved' | 'scheduled';
  /** Đợt 2: quyền xem của bài Tường công ty; thiếu là `company`. Khác `company` thì vẫn phát (cho realtime) nhưng thông báo (catalog) phải bỏ qua sự kiện này. */
  readonly visibility?: SocialPostVisibility;
}

export interface SocialCommentCreatedPayload {
  readonly postId: string;
  readonly commentId: string;
  readonly postAuthorId: string;
  readonly parentAuthorId?: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly postTitle?: string;
  /** Người được nhắc trong chính bình luận này. */
  readonly mentionedUserIds?: readonly string[];
  /**
   * P3: nhóm của bài (thiếu là bài Tường công ty). Realtime dùng để gửi tín hiệu bình luận đúng phòng:
   * bên phát PHẢI điền cho bình luận của bài nhóm, nếu không tín hiệu bị coi là của Tường công ty.
   */
  readonly groupId?: string;
}

/** Một sự kiện cho mỗi người được nhắc. */
export interface SocialMentionPayload {
  readonly postId: string;
  readonly commentId?: string;
  readonly mentionedUserId: string;
  readonly authorId: string;
  readonly authorName: string;
}

/* ========================================================================
 * P2/P3 — kiểu dùng chung giữa bài viết, nhóm và tìm kiếm
 * ====================================================================== */

/** Trạng thái bài. Máy trạng thái ở docs/architecture/social-p2-p3-api.md. */
export const SOCIAL_POST_STATUSES = ['published', 'pending', 'scheduled', 'rejected', 'deleted'] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const SOCIAL_POST_STATUS_LABELS: Readonly<Record<SocialPostStatus, string>> = {
  published: 'Đã đăng',
  pending: 'Chờ duyệt',
  scheduled: 'Hẹn giờ đăng',
  rejected: 'Bị từ chối',
  deleted: 'Đã xoá',
};

/** Trạng thái chưa đăng mà tác giả xem được ở "Bài của tôi". */
export const SOCIAL_MY_POST_STATUSES = ['pending', 'scheduled', 'rejected'] as const;
export type SocialMyPostStatus = (typeof SOCIAL_MY_POST_STATUSES)[number];

export const SOCIAL_FEED_SOURCES = ['wall', 'groups', 'all'] as const;
export type SocialFeedSource = (typeof SOCIAL_FEED_SOURCES)[number];

/** Loại bài tự sinh. Thêm loại mới là thêm giá trị ở đây (không cần migration). */
export const SOCIAL_ACTIVITY_TYPES = ['avatar.updated'] as const;
export type SocialActivityType = (typeof SOCIAL_ACTIVITY_TYPES)[number];

/** Câu mô tả hiển thị sau tên người, ví dụ "Nguyễn Văn A đã cập nhật ảnh đại diện". */
export const SOCIAL_ACTIVITY_LABELS: Readonly<Record<SocialActivityType, string>> = {
  'avatar.updated': 'đã cập nhật ảnh đại diện',
};

export interface SocialPostActivity {
  readonly type: SocialActivityType;
  /** JSON tuỳ loại; `avatar.updated` không cần dữ liệu (ảnh lấy theo `author.avatarUrl`). */
  readonly payload: Readonly<Record<string, unknown>>;
}

/* ---- Nhóm: phần dùng chung với SocialPost ---- */

export const SOCIAL_GROUP_PRIVACIES = ['public', 'private'] as const;
export type SocialGroupPrivacy = (typeof SOCIAL_GROUP_PRIVACIES)[number];

export const SOCIAL_GROUP_PRIVACY_LABELS: Readonly<Record<SocialGroupPrivacy, string>> = {
  public: 'Công khai',
  private: 'Riêng tư',
};

/** Khoá màu bìa; giao diện ánh xạ sang mã màu của design token. */
export const SOCIAL_GROUP_COLORS = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'violet', 'slate'] as const;
export type SocialGroupColor = (typeof SOCIAL_GROUP_COLORS)[number];

export const SOCIAL_GROUP_COLOR_LABELS: Readonly<Record<SocialGroupColor, string>> = {
  blue: 'Xanh dương',
  teal: 'Xanh ngọc',
  green: 'Xanh lá',
  amber: 'Vàng',
  orange: 'Cam',
  red: 'Đỏ',
  violet: 'Tím',
  slate: 'Xám',
};

/** Khoá biểu tượng bìa; giao diện ánh xạ sang icon của thư viện (không dùng emoji). */
export const SOCIAL_GROUP_ICONS = [
  'users',
  'briefcase',
  'megaphone',
  'lightbulb',
  'book',
  'heart',
  'rocket',
  'star',
  'calendar',
  'message',
  'trophy',
  'globe',
] as const;
export type SocialGroupIcon = (typeof SOCIAL_GROUP_ICONS)[number];

export const SOCIAL_GROUP_ICON_LABELS: Readonly<Record<SocialGroupIcon, string>> = {
  users: 'Nhóm người',
  briefcase: 'Công việc',
  megaphone: 'Thông báo',
  lightbulb: 'Ý tưởng',
  book: 'Học tập',
  heart: 'Gắn kết',
  rocket: 'Dự án',
  star: 'Nổi bật',
  calendar: 'Sự kiện',
  message: 'Thảo luận',
  trophy: 'Thành tích',
  globe: 'Cộng đồng',
};

export const SOCIAL_GROUP_DEFAULT_COLOR: SocialGroupColor = 'blue';
export const SOCIAL_GROUP_DEFAULT_ICON: SocialGroupIcon = 'users';

/** Nhóm rút gọn gắn vào bài. */
export interface SocialGroupRef {
  readonly id: string;
  readonly name: string;
  readonly privacy: SocialGroupPrivacy;
  readonly color: SocialGroupColor;
  readonly icon: SocialGroupIcon;
}

/* ---- Bình chọn ---- */

export const SOCIAL_POLL_OPTIONS_MIN = 2;
export const SOCIAL_POLL_OPTIONS_MAX = 10;
export const SOCIAL_POLL_QUESTION_MAX = 300;
export const SOCIAL_POLL_OPTION_MAX = 200;

export interface CreateSocialPollRequest {
  readonly question: string;
  /** `SOCIAL_POLL_OPTIONS_MIN`–`SOCIAL_POLL_OPTIONS_MAX` lựa chọn, không trùng nhau (không phân biệt hoa thường). */
  readonly options: readonly string[];
  /** Mặc định `false` (chọn một). */
  readonly allowMultiple?: boolean;
  /** Mặc định `false` (công khai). Ẩn danh thì không ai, kể cả tác giả, xem được ai chọn gì. */
  readonly anonymous?: boolean;
  /** ISO 8601, ở tương lai; thiếu là không hạn. */
  readonly closesAt?: string;
}

export interface UpdateSocialPollRequest {
  /** `null` để bỏ hạn. Không được ở quá khứ. */
  readonly closesAt?: string | null;
}

export interface SocialPollOption {
  readonly id: string;
  readonly text: string;
  readonly voteCount: number;
}

export interface SocialPoll {
  readonly id: string;
  readonly question: string;
  readonly allowMultiple: boolean;
  readonly anonymous: boolean;
  readonly closesAt?: string;
  readonly closedAt?: string;
  /** Đã đóng (thủ công hoặc quá hạn). */
  readonly isClosed: boolean;
  /** Theo thứ tự `position`. Số phiếu luôn xem được, không cần bỏ phiếu trước. */
  readonly options: readonly SocialPollOption[];
  /** Số người đã bỏ phiếu (mỗi người một lần dù chọn nhiều). */
  readonly totalVoters: number;
  /** Lựa chọn của người đang xem; rỗng là chưa bỏ phiếu. */
  readonly myOptionIds: readonly string[];
  readonly canVote: boolean;
  /** Công khai thì người xem được bài xem được ai chọn gì; ẩn danh luôn `false`. */
  readonly canViewVoters: boolean;
}

export interface SetSocialPollVoteRequest {
  /** Rỗng là bỏ phiếu. Bình chọn chọn một thì tối đa 1 phần tử. */
  readonly optionIds: readonly string[];
}

export interface SocialPollVoter {
  readonly user: SocialUserRef;
  readonly optionId: string;
  readonly votedAt: string;
}

export interface SocialPollVoterPage {
  readonly items: readonly SocialPollVoter[];
  readonly nextCursor?: string;
}

/* ---- Xác nhận đã đọc ---- */

export interface SocialReadConfirmationSummary {
  readonly required: true;
  readonly confirmedByMe: boolean;
  readonly confirmedAt?: string;
  /** Chỉ có khi người xem xem được danh sách (`capabilities.canViewReadConfirmations`). */
  readonly confirmedCount?: number;
  /** Số người thuộc phạm vi cần xác nhận (trừ tác giả). Cùng điều kiện với `confirmedCount`. */
  readonly audienceCount?: number;
  /** Người xem thuộc phạm vi cần xác nhận (không phải tác giả; thành viên nếu là bài nhóm). */
  readonly canConfirm: boolean;
}

export const SOCIAL_READ_CONFIRMATION_FILTERS = ['confirmed', 'pending'] as const;
export type SocialReadConfirmationFilter = (typeof SOCIAL_READ_CONFIRMATION_FILTERS)[number];

export interface SocialReadConfirmationEntry {
  readonly user: SocialUserRef;
  /** Có khi đã xác nhận. */
  readonly confirmedAt?: string;
}

export interface SocialReadConfirmationPage {
  readonly items: readonly SocialReadConfirmationEntry[];
  readonly confirmedCount: number;
  readonly audienceCount: number;
  readonly nextCursor?: string;
}

/* ---- Duyệt bài, bài của tôi, bài đã lưu ---- */

export const SOCIAL_REJECT_REASON_MAX = 500;
export const SOCIAL_SCHEDULE_MIN_LEAD_SECONDS = 60;
export const SOCIAL_SCHEDULE_MAX_DAYS = 365;

export interface RejectSocialPostRequest {
  readonly reason: string;
}

export interface SocialMyPostsQuery {
  readonly status: SocialMyPostStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SetSocialBookmarkRequest {
  readonly bookmarked: boolean;
}

export interface SocialBookmarkState {
  readonly bookmarked: boolean;
}

/** Số mục chờ xử lý, để hiện chấm số ở điều hướng (yêu cầu tham gia nhóm: xem `totalCount` của `SocialJoinRequestInboxPage`). */
export interface SocialInboxCounts {
  /** Bài của tôi đang chờ duyệt, hẹn giờ, bị từ chối. */
  readonly myPending: number;
  readonly myScheduled: number;
  readonly myRejected: number;
  /** Bài chờ duyệt cần moderator xử lý; 0 nếu không phải moderator. */
  readonly toModerate: number;
  readonly bookmarks: number;
}

/* ---- Cài đặt ---- */

export const SOCIAL_SETTING_KEYS = {
  wallRequireApproval: 'wall.requireApproval',
} as const;
export type SocialSettingKey = (typeof SOCIAL_SETTING_KEYS)[keyof typeof SOCIAL_SETTING_KEYS];

export interface SocialSettings {
  /** Bài trên Tường công ty của người không phải moderator cần duyệt. Mặc định `false`. */
  readonly wallRequireApproval: boolean;
}

export const SOCIAL_DEFAULT_SETTINGS: SocialSettings = { wallRequireApproval: false };

export interface UpdateSocialSettingsRequest {
  readonly wallRequireApproval?: boolean;
}

/** Tối đa người nhận thông báo gắn trong một sự kiện bài nhóm. */
export const SOCIAL_NOTIFY_RECIPIENT_MAX = 1_000;

/* ---- Payload sự kiện P2 ---- */

export interface SocialPostPendingPayload {
  readonly postId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly title?: string;
}

export interface SocialPostModeratedPayload {
  readonly postId: string;
  readonly authorId: string;
  readonly moderatorId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason?: string;
  readonly title?: string;
}

/** Dùng cho realtime; không tạo thông báo. */
export interface SocialPostChangedPayload {
  readonly postId: string;
  readonly groupId?: string;
  readonly change: 'updated' | 'deleted' | 'pinned' | 'unpinned';
  readonly actorId: string;
}

export interface SocialReactionChangedPayload {
  readonly postId: string;
  readonly groupId?: string;
  readonly actorId: string;
}

export interface SocialPollChangedPayload {
  readonly postId: string;
  readonly groupId?: string;
  readonly actorId: string;
  readonly change: 'voted' | 'closed';
}
