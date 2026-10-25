import {
  SOCIAL_ALLOWED_CONTENT_TYPES,
  SOCIAL_ATTACHMENT_MAX_BYTES,
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_VIDEO_CONTENT_TYPES,
  SOCIAL_VIDEO_LIMITS,
  SOCIAL_FEED_MAX_PAGE_SIZE,
  SOCIAL_FEED_PAGE_SIZE,
  SOCIAL_IMAGE_CONTENT_TYPES,
  SOCIAL_MAX_ATTACHMENTS_PER_POST,
  SOCIAL_MEDIA_LAYOUTS,
  SOCIAL_POST_BODY_MAX,
  SOCIAL_POST_KINDS,
  SOCIAL_POST_TITLE_MAX,
  SOCIAL_REACTION_TYPES,
  SOCIAL_TOPIC_NAME_MAX,
  type SocialAttachmentPurpose,
  type SocialMediaLayout,
  type SocialPostKind,
  type SocialReactionType,
} from '@enterprise-platform/contracts-social';
import { htmlToPlainText, sanitizeHtml } from './html-sanitizer.js';
import { SocialValidationError, SocialVideoFailedError } from './social.error.js';

/** Tối đa người được nhắc tên trong một bài hay một bình luận. */
export const SOCIAL_MAX_MENTIONS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Id trên URL hay trong body không phải UUID thì không thể tồn tại. */
export function requireUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new SocialValidationError(`${label} không hợp lệ.`);
  return value;
}

/* ------------------------------------------------------------- bài viết */

export function normalizeKind(kind: unknown): SocialPostKind {
  if (kind === undefined || kind === null) return 'post';
  if (!(SOCIAL_POST_KINDS as readonly unknown[]).includes(kind)) {
    throw new SocialValidationError('Loại bài viết không hợp lệ.');
  }
  return kind as SocialPostKind;
}

/** Tiêu đề rỗng nghĩa là không có tiêu đề. */
export function normalizeTitle(title: unknown): string | undefined {
  if (title === undefined || title === null) return undefined;
  if (typeof title !== 'string') throw new SocialValidationError('Tiêu đề không hợp lệ.');
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > SOCIAL_POST_TITLE_MAX) {
    throw new SocialValidationError(`Tiêu đề tối đa ${SOCIAL_POST_TITLE_MAX} ký tự.`);
  }
  return trimmed;
}

export interface NormalizedBody {
  readonly html: string;
  /** Có chữ thật sự (không chỉ thẻ rỗng). */
  readonly hasText: boolean;
}

/** Làm sạch rồi kiểm độ dài; độ dài kiểm cả trước và sau khi làm sạch. */
export function normalizeBody(bodyHtml: unknown): NormalizedBody {
  if (typeof bodyHtml !== 'string') throw new SocialValidationError('Nội dung bài viết không hợp lệ.');
  if (bodyHtml.length > SOCIAL_POST_BODY_MAX * 2) {
    throw new SocialValidationError(`Nội dung tối đa ${SOCIAL_POST_BODY_MAX} ký tự.`);
  }
  const html = sanitizeHtml(bodyHtml);
  if (html.length > SOCIAL_POST_BODY_MAX) {
    throw new SocialValidationError(`Nội dung tối đa ${SOCIAL_POST_BODY_MAX} ký tự.`);
  }
  return { html, hasText: htmlToPlainText(html).length > 0 };
}

/** Một bài phải có chữ hoặc ít nhất một tệp đính kèm. */
export function requireContent(body: NormalizedBody, attachmentCount: number): void {
  if (!body.hasText && attachmentCount === 0) {
    throw new SocialValidationError('Hãy nhập nội dung hoặc đính kèm ít nhất một tệp.');
  }
}

/** Danh sách id (tệp, người) không trùng, đúng UUID, không quá `max`. */
export function normalizeIdList(value: unknown, label: string, max: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SocialValidationError(`${label} không hợp lệ.`);
  const ids = [...new Set(value.map((item) => requireUuid(item, label)))];
  if (ids.length > max) throw new SocialValidationError(`${label} tối đa ${max} mục.`);
  return ids;
}

export function normalizeAttachmentIds(value: unknown): string[] {
  return normalizeIdList(value, 'Tệp đính kèm', SOCIAL_MAX_ATTACHMENTS_PER_POST);
}

export function normalizeMentionIds(value: unknown): string[] {
  return normalizeIdList(value, 'Người được nhắc', SOCIAL_MAX_MENTIONS);
}

export function normalizeReactionType(type: unknown): SocialReactionType | null {
  if (type === null) return null;
  if (!(SOCIAL_REACTION_TYPES as readonly unknown[]).includes(type)) {
    throw new SocialValidationError('Loại phản ứng không hợp lệ.');
  }
  return type as SocialReactionType;
}

/* ------------------------------------------------------------ bình luận */

export function normalizeCommentBody(body: unknown, options: { readonly allowEmpty?: boolean } = {}): string {
  if (typeof body !== 'string') throw new SocialValidationError('Nội dung bình luận không hợp lệ.');
  const trimmed = body.trim();
  // Bình luận chỉ có ảnh thì nội dung được để trống.
  if (!trimmed && !options.allowEmpty) throw new SocialValidationError('Bình luận không được để trống.');
  if (trimmed.length > SOCIAL_COMMENT_MAX) {
    throw new SocialValidationError(`Bình luận tối đa ${SOCIAL_COMMENT_MAX} ký tự.`);
  }
  return trimmed;
}

/** Id người dùng trong các token `@[userId]` của bình luận. */
export function mentionIdsInBody(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/@\[([0-9a-f-]{36})\]/gi)) {
    if (isUuid(match[1])) found.add(match[1].toLowerCase());
  }
  return [...found];
}

/** Gộp người nhắc khai báo với token trong nội dung; không trùng, không quá giới hạn. */
export function mergeMentions(declared: readonly string[], inBody: readonly string[]): string[] {
  const merged = [...new Set([...declared.map((id) => id.toLowerCase()), ...inBody])];
  if (merged.length > SOCIAL_MAX_MENTIONS) {
    throw new SocialValidationError(`Chỉ được nhắc tối đa ${SOCIAL_MAX_MENTIONS} người.`);
  }
  return merged;
}

/**
 * Bình luận chỉ có hai cấp: trả lời được gắn vào bình luận gốc, không gắn vào
 * một trả lời khác.
 */
export function assertReplyTarget(parent: { readonly parentId?: string | null }): void {
  if (parent.parentId) {
    throw new SocialValidationError(
      'Chỉ trả lời được bình luận gốc. Hãy trả lời vào bình luận gốc của chuỗi này.',
    );
  }
}

/* ------------------------------------------------------------ chuyên mục */

export function normalizeTopicName(name: unknown): string {
  if (typeof name !== 'string') throw new SocialValidationError('Tên chuyên mục không hợp lệ.');
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new SocialValidationError('Tên chuyên mục không được để trống.');
  if (trimmed.length > SOCIAL_TOPIC_NAME_MAX) {
    throw new SocialValidationError(`Tên chuyên mục tối đa ${SOCIAL_TOPIC_NAME_MAX} ký tự.`);
  }
  return trimmed;
}

/* ------------------------------------------------------------- tệp đính kèm */

export interface NormalizedAttachmentInput {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/**
 * Kiểu tệp và dung lượng tối đa được nhận cho từng nơi gắn. Bình luận nhận ảnh và video; bài viết nhận tài liệu,
 * ảnh và video. Dung lượng video theo `SOCIAL_VIDEO_LIMITS` (video được chuyển mã ở nền nên nhận bản gốc lớn).
 */
export function attachmentRulesFor(purpose: SocialAttachmentPurpose): {
  readonly allowedTypes: readonly string[];
  readonly maxBytesFor: (contentType: string) => number;
  readonly typeError: string;
} {
  const videoMax = SOCIAL_VIDEO_LIMITS[purpose].maxBytes;
  if (purpose === 'comment') {
    return {
      allowedTypes: [...SOCIAL_IMAGE_CONTENT_TYPES, ...SOCIAL_VIDEO_CONTENT_TYPES],
      maxBytesFor: (contentType) =>
        SOCIAL_VIDEO_CONTENT_TYPES.includes(contentType) ? videoMax : SOCIAL_COMMENT_IMAGE_MAX_BYTES,
      typeError: 'Bình luận chỉ nhận ảnh JPEG, PNG, GIF, WebP hoặc video MP4, WebM, MOV.',
    };
  }
  return {
    allowedTypes: [...SOCIAL_ALLOWED_CONTENT_TYPES, ...SOCIAL_VIDEO_CONTENT_TYPES],
    maxBytesFor: (contentType) => (SOCIAL_VIDEO_CONTENT_TYPES.includes(contentType) ? videoMax : SOCIAL_ATTACHMENT_MAX_BYTES),
    typeError:
      'Loại tệp này không được hỗ trợ. Chỉ nhận PDF, Word, Excel, PowerPoint, ZIP, ảnh JPEG, PNG, GIF, WebP và video MP4, WebM, MOV.',
  };
}

function formatMaxSize(maxBytes: number): string {
  const gigabyte = 1024 * 1024 * 1024;
  if (maxBytes >= gigabyte && maxBytes % gigabyte === 0) return `${maxBytes / gigabyte} GB`;
  return `${Math.floor(maxBytes / (1024 * 1024))} MB`;
}

export function normalizeAttachmentInput(
  input: {
    readonly fileName?: unknown;
    readonly contentType?: unknown;
    readonly sizeBytes?: unknown;
  },
  purpose: 'post' | 'comment' = 'post',
): NormalizedAttachmentInput {
  const rules = attachmentRulesFor(purpose);
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  if (!fileName) throw new SocialValidationError('Tên tệp không được để trống.');
  if (fileName.length > 255) throw new SocialValidationError('Tên tệp tối đa 255 ký tự.');
  if (/[\\/]/.test(fileName)) throw new SocialValidationError('Tên tệp không được chứa dấu gạch chéo.');

  const contentType = typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : '';
  if (!rules.allowedTypes.includes(contentType)) {
    throw new SocialValidationError(rules.typeError);
  }

  const sizeBytes = input.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new SocialValidationError('Dung lượng tệp không hợp lệ.');
  }
  const maxBytes = rules.maxBytesFor(contentType);
  if (sizeBytes > maxBytes) {
    throw new SocialValidationError(`Tệp tối đa ${formatMaxSize(maxBytes)}.`);
  }
  return { fileName, contentType, sizeBytes };
}

export function isVideoContentType(contentType: string): boolean {
  return SOCIAL_VIDEO_CONTENT_TYPES.includes(contentType);
}

export function isImageContentType(contentType: string): boolean {
  return SOCIAL_IMAGE_CONTENT_TYPES.includes(contentType);
}

/** Phần của một tệp đã tải mà luật gắn tệp cần biết. */
export interface AttachableFacts {
  readonly contentType: string;
  readonly purpose: SocialAttachmentPurpose;
  readonly processingStatus: 'none' | 'queued' | 'processing' | 'ready' | 'failed';
}

/**
 * Chặn đăng khi có video xử lý lỗi: chung cho bài viết và bình luận. Video đang chờ (`queued`) hoặc đang xử lý
 * (`processing`) vẫn đăng được, người xem thấy khung "đang xử lý" cho tới khi video sẵn sàng.
 */
export function assertAttachmentsPostable(files: readonly Pick<AttachableFacts, 'processingStatus'>[]): void {
  if (files.some((file) => file.processingStatus === 'failed')) throw new SocialVideoFailedError();
}

/**
 * Luật tập tệp của một bài hay một bình luận: video chỉ gắn đúng nơi đã tải lên (video của bình luận không gắn vào
 * bài và ngược lại), bài tối đa `SOCIAL_VIDEO_LIMITS.post.maxVideos` video và được gồm ảnh, video và tài liệu cùng
 * nhau, bình luận tối đa 1 video và 4 tệp. Số tệp tối đa của bài đã kiểm ở `normalizeAttachmentIds`.
 */
export function assertAttachmentSet(target: SocialAttachmentPurpose, files: readonly AttachableFacts[]): void {
  const videos = files.filter((file) => isVideoContentType(file.contentType));
  if (videos.some((video) => video.purpose !== target)) {
    throw new SocialValidationError(
      target === 'post'
        ? 'Video này được tải lên cho bình luận, không đính kèm vào bài viết được. Hãy tải lại video trong bài viết.'
        : 'Video này được tải lên cho bài viết, không đính kèm vào bình luận được. Hãy tải lại video trong bình luận.',
    );
  }
  const limits = SOCIAL_VIDEO_LIMITS[target];
  if (videos.length > limits.maxVideos) {
    throw new SocialValidationError(
      target === 'post'
        ? `Mỗi bài viết đính kèm tối đa ${limits.maxVideos} video.`
        : `Mỗi bình luận chỉ đính kèm tối đa ${limits.maxVideos} video.`,
    );
  }
  if (target === 'post') {
    if (files.length > SOCIAL_MAX_ATTACHMENTS_PER_POST) {
      throw new SocialValidationError(`Mỗi bài viết đính kèm tối đa ${SOCIAL_MAX_ATTACHMENTS_PER_POST} tệp.`);
    }
  } else if (files.length > SOCIAL_COMMENT_MAX_ATTACHMENTS) {
    throw new SocialValidationError(`Mỗi bình luận đính kèm tối đa ${SOCIAL_COMMENT_MAX_ATTACHMENTS} tệp.`);
  }
}

/**
 * Cách xếp ảnh và video do client gửi: thiếu (`undefined`, `null`, chuỗi rỗng) trả `undefined` để người gọi dùng mặc
 * định (tạo bài) hoặc giữ nguyên (sửa bài); giá trị lạ là 400 `VALIDATION`.
 */
export function normalizeMediaLayout(value: unknown): SocialMediaLayout | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!(SOCIAL_MEDIA_LAYOUTS as readonly unknown[]).includes(value)) {
    throw new SocialValidationError('Cách xếp ảnh và video không hợp lệ.');
  }
  return value as SocialMediaLayout;
}

/** Tên tệp an toàn cho khoá object: bỏ dấu tiếng Việt, ký tự lạ thành "-". */
export function safeObjectName(fileName: string): string {
  const safe = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80);
  return safe || 'file';
}

/* ------------------------------------------------------------- con trỏ */

export interface CursorPosition {
  /** ISO UTC, có thể tới micro giây. */
  readonly at: string;
  readonly id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.at, position.id]), 'utf8').toString('base64url');
}

/** Thời điểm trong cursor giữ độ chính xác micro giây của Postgres, để không bỏ sót dòng cùng mili giây. */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function decodeCursor(cursor: string | undefined): CursorPosition | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      CURSOR_TIME.test(parsed[0]) &&
      !Number.isNaN(new Date(parsed[0]).getTime()) &&
      isUuid(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // rơi xuống lỗi chung
  }
  throw new SocialValidationError('Con trỏ phân trang không hợp lệ.');
}

/** Thời điểm của dòng DB (micro giây) rút về ISO mili giây cho API. */
export function toIso(value: string): string {
  return new Date(value).toISOString();
}

/** Cỡ trang: mặc định `SOCIAL_FEED_PAGE_SIZE`, trần `SOCIAL_FEED_MAX_PAGE_SIZE`. */
export function normalizeLimit(limit: unknown, fallback = SOCIAL_FEED_PAGE_SIZE): number {
  if (limit === undefined || limit === null || limit === '') return fallback;
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) throw new SocialValidationError('Cỡ trang không hợp lệ.');
  return Math.min(value, SOCIAL_FEED_MAX_PAGE_SIZE);
}
