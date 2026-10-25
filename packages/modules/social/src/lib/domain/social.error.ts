/**
 * Lỗi nghiệp vụ của phân hệ Mạng nội bộ.
 *
 * Controller bắt đúng lớp này và đổi thành `HttpException` kèm `{ statusCode,
 * code, message }`; lỗi khác là bug và để Nest trả 500. `message` là tiếng Việt,
 * hiển thị thẳng cho người dùng.
 */
export class SocialError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SocialError.prototype);
  }
}

export class SocialValidationError extends SocialError {
  constructor(message: string) {
    super('VALIDATION', message, 400);
    Object.setPrototypeOf(this, SocialValidationError.prototype);
  }
}

export class SocialForbiddenError extends SocialError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super('FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, SocialForbiddenError.prototype);
  }
}

export class SocialPostNotFoundError extends SocialError {
  constructor() {
    super('POST_NOT_FOUND', 'Bài viết không tồn tại hoặc đã bị xoá.', 404);
    Object.setPrototypeOf(this, SocialPostNotFoundError.prototype);
  }
}

export class SocialCommentNotFoundError extends SocialError {
  constructor() {
    super('COMMENT_NOT_FOUND', 'Bình luận không tồn tại hoặc đã bị xoá.', 404);
    Object.setPrototypeOf(this, SocialCommentNotFoundError.prototype);
  }
}

export class SocialTopicNotFoundError extends SocialError {
  constructor() {
    super('TOPIC_NOT_FOUND', 'Chuyên mục không tồn tại.', 404);
    Object.setPrototypeOf(this, SocialTopicNotFoundError.prototype);
  }
}

export class SocialTopicInactiveError extends SocialError {
  constructor() {
    super('TOPIC_INACTIVE', 'Chuyên mục này đã ngừng sử dụng.', 409);
    Object.setPrototypeOf(this, SocialTopicInactiveError.prototype);
  }
}

export class SocialTopicNameTakenError extends SocialError {
  constructor(name: string) {
    super('TOPIC_NAME_TAKEN', `Đã có chuyên mục tên "${name}".`, 409);
    Object.setPrototypeOf(this, SocialTopicNameTakenError.prototype);
  }
}

export class SocialAttachmentNotFoundError extends SocialError {
  constructor() {
    super('ATTACHMENT_NOT_FOUND', 'Tệp đính kèm không tồn tại.', 404);
    Object.setPrototypeOf(this, SocialAttachmentNotFoundError.prototype);
  }
}

/** Tệp chưa tải xong, của người khác, hoặc đã gắn vào bài khác. */
export class SocialAttachmentUnavailableError extends SocialError {
  constructor() {
    super(
      'ATTACHMENT_UNAVAILABLE',
      'Có tệp đính kèm chưa tải xong, không phải của bạn hoặc đã được dùng ở bài khác.',
      409,
    );
    Object.setPrototypeOf(this, SocialAttachmentUnavailableError.prototype);
  }
}

/** Tệp tải lên kho không khớp với khai báo (thiếu tệp hoặc sai dung lượng). */
export class SocialUploadMismatchError extends SocialError {
  constructor(message: string) {
    super('UPLOAD_MISMATCH', message, 409);
    Object.setPrototypeOf(this, SocialUploadMismatchError.prototype);
  }
}

/** Người dùng hoặc tenant gọi tải lên quá dày. */
export class SocialRateLimitedError extends SocialError {
  constructor(message = 'Bạn tải lên quá nhanh. Hãy thử lại sau ít giây.') {
    super('SOCIAL_RATE_LIMITED', message, 429);
    Object.setPrototypeOf(this, SocialRateLimitedError.prototype);
  }
}

/** Người dùng đang có quá nhiều lần tải dang dở. */
export class SocialTooManyPendingUploadsError extends SocialError {
  constructor() {
    super(
      'SOCIAL_TOO_MANY_PENDING_UPLOADS',
      'Bạn có quá nhiều tệp đang tải dở. Hãy hoàn tất hoặc huỷ bớt rồi thử lại.',
      429,
    );
    Object.setPrototypeOf(this, SocialTooManyPendingUploadsError.prototype);
  }
}

/** Tổng dung lượng tệp chưa gắn của một người vượt trần. */
export class SocialUnattachedBytesExceededError extends SocialError {
  constructor() {
    super(
      'SOCIAL_UNATTACHED_BYTES_EXCEEDED',
      'Bạn đang có quá nhiều tệp tải lên chưa đăng. Hãy đăng hoặc bỏ bớt tệp rồi thử lại.',
      429,
    );
    Object.setPrototypeOf(this, SocialUnattachedBytesExceededError.prototype);
  }
}

/** Quá nhiều video đang chờ hoặc đang chuyển mã (của người dùng hoặc của cả tenant). */
export class SocialVideoTooManyProcessingError extends SocialError {
  constructor() {
    super(
      'SOCIAL_VIDEO_TOO_MANY_PROCESSING',
      'Đang có quá nhiều video chờ xử lý. Hãy đợi các video trước xử lý xong rồi tải tiếp.',
      429,
    );
    Object.setPrototypeOf(this, SocialVideoTooManyProcessingError.prototype);
  }
}

/** Video xử lý lỗi (`failed`) nên không gắn vào bài hay bình luận được; video đang chờ hoặc đang xử lý thì gắn được. */
export class SocialVideoFailedError extends SocialError {
  constructor() {
    super('SOCIAL_VIDEO_FAILED', 'Video xử lý lỗi, chưa thể đăng. Hãy gỡ video rồi thử lại.', 409);
    Object.setPrototypeOf(this, SocialVideoFailedError.prototype);
  }
}

/** Tệp đã gắn vào bài hay bình luận nên không bỏ riêng được. */
export class SocialAttachmentInUseError extends SocialError {
  constructor() {
    super('SOCIAL_ATTACHMENT_IN_USE', 'Tệp đã được đính kèm vào bài viết hoặc bình luận nên không thể bỏ.', 409);
    Object.setPrototypeOf(this, SocialAttachmentInUseError.prototype);
  }
}

/** Tenant đã bật phân hệ nhưng migration chưa chạy xong. */
export class SocialNotProvisionedError extends SocialError {
  constructor() {
    super(
      'MODULE_NOT_PROVISIONED',
      'Dữ liệu Mạng nội bộ của tenant đang được khởi tạo. Thử lại sau ít phút.',
      503,
    );
    Object.setPrototypeOf(this, SocialNotProvisionedError.prototype);
  }
}

/** Hệ dùng chung báo tenant đã hết hạn mức dung lượng; `message` lấy nguyên từ Hệ dùng chung. */
export class SocialStorageQuotaExceededError extends SocialError {
  constructor(message = 'Đã vượt hạn mức dung lượng của gói. Hãy liên hệ quản trị để mua thêm dung lượng.') {
    super('STORAGE_QUOTA_EXCEEDED', message, 413);
    Object.setPrototypeOf(this, SocialStorageQuotaExceededError.prototype);
  }
}
