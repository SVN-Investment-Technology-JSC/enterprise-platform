import { SOCIAL_VISIBILITY_ERROR_CODES } from '@enterprise-platform/contracts-social';
import { SocialError } from './social.error.js';

/** Quyền xem không đi cùng nhóm hoặc loại bài/tính năng đã chọn (thông báo, ghim, xác nhận đã đọc...). */
export class SocialVisibilityNotAllowedError extends SocialError {
  constructor(message = 'Quyền xem này không dùng được cho bài viết này.') {
    super(SOCIAL_VISIBILITY_ERROR_CODES.notAllowed, message, 400);
    Object.setPrototypeOf(this, SocialVisibilityNotAllowedError.prototype);
  }
}

/** `custom` mà không có ai, hoặc người/phòng ban không có trong danh bạ. */
export class SocialVisibilityAudienceError extends SocialError {
  constructor(message = 'Danh sách chia sẻ không hợp lệ.') {
    super(SOCIAL_VISIBILITY_ERROR_CODES.audienceInvalid, message, 400);
    Object.setPrototypeOf(this, SocialVisibilityAudienceError.prototype);
  }
}

/** Chọn `unit` nhưng tác giả chưa thuộc phòng ban nào. */
export class SocialVisibilityUnitUnknownError extends SocialError {
  constructor() {
    super(
      SOCIAL_VISIBILITY_ERROR_CODES.unitUnknown,
      'Bạn chưa thuộc phòng ban nào nên chưa thể chia sẻ bài viết cho phòng ban.',
      400,
    );
    Object.setPrototypeOf(this, SocialVisibilityUnitUnknownError.prototype);
  }
}

/** Không phải tác giả, hoặc bài ở trạng thái không đổi được quyền xem. */
export class SocialVisibilityChangeForbiddenError extends SocialError {
  constructor(message = 'Chỉ tác giả mới đổi được quyền xem của bài viết đã đăng hoặc đang hẹn giờ.') {
    super(SOCIAL_VISIBILITY_ERROR_CODES.changeForbidden, message, 403);
    Object.setPrototypeOf(this, SocialVisibilityChangeForbiddenError.prototype);
  }
}

/** Bài đã tắt bình luận. */
export class SocialCommentsDisabledError extends SocialError {
  constructor() {
    super(SOCIAL_VISIBILITY_ERROR_CODES.commentsDisabled, 'Bài viết này đã tắt bình luận.', 403);
    Object.setPrototypeOf(this, SocialCommentsDisabledError.prototype);
  }
}
