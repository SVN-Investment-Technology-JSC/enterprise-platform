import { SocialError } from './social.error.js';

/**
 * Lỗi nghiệp vụ của đường ghi bài (P2): trạng thái bài, bình chọn, xác nhận đã đọc, nhóm.
 * Cùng khung với `SocialError`: controller đổi thành `{ statusCode, code, message }`.
 */

/** Bài không ở trạng thái cho phép thao tác (duyệt bài đã đăng, đăng ngay bài chưa hẹn giờ...). */
export class SocialPostStateError extends SocialError {
  constructor(message = 'Bài viết không ở trạng thái cho phép thực hiện thao tác này.') {
    super('POST_STATE', message, 409);
    Object.setPrototypeOf(this, SocialPostStateError.prototype);
  }
}

/** Sửa lựa chọn của bình chọn khi đã có phiếu. */
export class SocialPollLockedError extends SocialError {
  constructor() {
    super(
      'POLL_LOCKED',
      'Bình chọn đã có người bỏ phiếu nên không sửa được lựa chọn. Bạn chỉ đổi được hạn đóng.',
      409,
    );
    Object.setPrototypeOf(this, SocialPollLockedError.prototype);
  }
}

export class SocialPollClosedError extends SocialError {
  constructor() {
    super('POLL_CLOSED', 'Bình chọn này đã đóng.', 409);
    Object.setPrototypeOf(this, SocialPollClosedError.prototype);
  }
}

/** Bình chọn ẩn danh: không ai xem được ai chọn gì. */
export class SocialPollAnonymousError extends SocialError {
  constructor() {
    super('POLL_ANONYMOUS', 'Bình chọn ẩn danh nên không xem được người bỏ phiếu.', 403);
    Object.setPrototypeOf(this, SocialPollAnonymousError.prototype);
  }
}

export class SocialPollNotFoundError extends SocialError {
  constructor() {
    super('POLL_NOT_FOUND', 'Bài viết này không có bình chọn.', 404);
    Object.setPrototypeOf(this, SocialPollNotFoundError.prototype);
  }
}

export class SocialReadConfirmationNotRequiredError extends SocialError {
  constructor() {
    super('NOT_REQUIRED', 'Bài viết này không yêu cầu xác nhận đã đọc.', 400);
    Object.setPrototypeOf(this, SocialReadConfirmationNotRequiredError.prototype);
  }
}

/** Không tắt được xác nhận đã đọc khi đã có người xác nhận. */
export class SocialReadConfirmationLockedError extends SocialError {
  constructor() {
    super(
      'READ_CONFIRMATION_LOCKED',
      'Đã có người xác nhận đã đọc nên không tắt được yêu cầu này.',
      409,
    );
    Object.setPrototypeOf(this, SocialReadConfirmationLockedError.prototype);
  }
}

/** Đăng vào nhóm công khai mà chưa là thành viên. */
export class SocialGroupNotMemberError extends SocialError {
  constructor() {
    super('GROUP_NOT_MEMBER', 'Bạn cần là thành viên của nhóm để đăng bài vào nhóm này.', 403);
    Object.setPrototypeOf(this, SocialGroupNotMemberError.prototype);
  }
}

/** Dùng chung mã `GROUP_NOT_FOUND` với đường đọc nhóm (BE-2). */
export class SocialPostGroupNotFoundError extends SocialError {
  constructor() {
    super('GROUP_NOT_FOUND', 'Nhóm không tồn tại hoặc đã bị xoá.', 404);
    Object.setPrototypeOf(this, SocialPostGroupNotFoundError.prototype);
  }
}
