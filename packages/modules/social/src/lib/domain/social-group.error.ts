import { SOCIAL_GROUP_ERROR_CODES, SOCIAL_GROUP_V2_ERROR_CODES } from '@enterprise-platform/contracts-social';
import { SocialError } from './social.error.js';

/** Nhóm không có, đã xoá, hoặc người gọi không được biết là có (nhóm riêng tư ngoài nhóm). */
export class SocialGroupNotFoundError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_ERROR_CODES.notFound, 'Nhóm không tồn tại hoặc đã bị xoá.', 404);
    Object.setPrototypeOf(this, SocialGroupNotFoundError.prototype);
  }
}

export class SocialGroupNameTakenError extends SocialError {
  constructor(name: string) {
    super(SOCIAL_GROUP_ERROR_CODES.nameTaken, `Đã có nhóm tên "${name}".`, 409);
    Object.setPrototypeOf(this, SocialGroupNameTakenError.prototype);
  }
}

export class SocialGroupNotMemberError extends SocialError {
  constructor(message = 'Bạn không phải thành viên của nhóm này.', statusCode = 403) {
    super(SOCIAL_GROUP_ERROR_CODES.notMember, message, statusCode);
    Object.setPrototypeOf(this, SocialGroupNotMemberError.prototype);
  }
}

export class SocialGroupAlreadyMemberError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_ERROR_CODES.alreadyMember, 'Bạn đã là thành viên của nhóm này.', 409);
    Object.setPrototypeOf(this, SocialGroupAlreadyMemberError.prototype);
  }
}

export class SocialGroupLastAdminError extends SocialError {
  constructor() {
    super(
      SOCIAL_GROUP_ERROR_CODES.lastAdmin,
      'Nhóm phải còn ít nhất một quản trị viên. Hãy chỉ định quản trị viên khác trước.',
      409,
    );
    Object.setPrototypeOf(this, SocialGroupLastAdminError.prototype);
  }
}

export class SocialGroupJoinRequestExistsError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_ERROR_CODES.requestExists, 'Bạn đã gửi yêu cầu tham gia nhóm này và đang chờ duyệt.', 409);
    Object.setPrototypeOf(this, SocialGroupJoinRequestExistsError.prototype);
  }
}

export class SocialGroupJoinRequestNotFoundError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_ERROR_CODES.requestNotFound, 'Yêu cầu tham gia không tồn tại hoặc đã được xử lý.', 404);
    Object.setPrototypeOf(this, SocialGroupJoinRequestNotFoundError.prototype);
  }
}

/* ------------------------------------------------------------- đợt 2 */

/** Nhóm hạn chế người đăng bài và người gọi không được phép. */
export class SocialGroupPostNotAllowedError extends SocialError {
  constructor() {
    super(
      SOCIAL_GROUP_V2_ERROR_CODES.postNotAllowed,
      'Nhóm này chỉ cho phép một số thành viên đăng bài.',
      403,
    );
    Object.setPrototypeOf(this, SocialGroupPostNotAllowedError.prototype);
  }
}

export class SocialGroupTopicNotFoundError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_V2_ERROR_CODES.topicNotFound, 'Chủ đề của nhóm không tồn tại hoặc đã bị xoá.', 404);
    Object.setPrototypeOf(this, SocialGroupTopicNotFoundError.prototype);
  }
}

export class SocialGroupTopicNameTakenError extends SocialError {
  constructor(name: string) {
    super(SOCIAL_GROUP_V2_ERROR_CODES.topicNameTaken, `Nhóm đã có chủ đề tên "${name}".`, 409);
    Object.setPrototypeOf(this, SocialGroupTopicNameTakenError.prototype);
  }
}

export class SocialGroupTopicLimitError extends SocialError {
  constructor(max: number) {
    super(SOCIAL_GROUP_V2_ERROR_CODES.topicLimit, `Mỗi nhóm có tối đa ${max} chủ đề.`, 409);
    Object.setPrototypeOf(this, SocialGroupTopicLimitError.prototype);
  }
}

export class SocialGroupPriorityLimitError extends SocialError {
  constructor(max: number) {
    super(
      SOCIAL_GROUP_V2_ERROR_CODES.priorityLimit,
      `Bạn chỉ ưu tiên được tối đa ${max} nhóm. Hãy bỏ ưu tiên một nhóm khác trước.`,
      409,
    );
    Object.setPrototypeOf(this, SocialGroupPriorityLimitError.prototype);
  }
}

export class SocialGroupNoMemberSourcesError extends SocialError {
  constructor() {
    super(
      SOCIAL_GROUP_V2_ERROR_CODES.noMemberSources,
      'Nhóm chưa chọn phòng ban hoặc vị trí để đồng bộ thành viên.',
      400,
    );
    Object.setPrototypeOf(this, SocialGroupNoMemberSourcesError.prototype);
  }
}

export class SocialGroupSourceUnknownError extends SocialError {
  constructor() {
    super(
      SOCIAL_GROUP_V2_ERROR_CODES.sourceUnknown,
      'Có phòng ban hoặc vị trí không còn trong sơ đồ tổ chức.',
      400,
    );
    Object.setPrototypeOf(this, SocialGroupSourceUnknownError.prototype);
  }
}

export class SocialReportExistsError extends SocialError {
  constructor() {
    super(
      SOCIAL_GROUP_V2_ERROR_CODES.reportExists,
      'Bạn đã báo cáo mục này và báo cáo đang chờ xử lý.',
      409,
    );
    Object.setPrototypeOf(this, SocialReportExistsError.prototype);
  }
}

export class SocialReportNotFoundError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_V2_ERROR_CODES.reportNotFound, 'Báo cáo không tồn tại.', 404);
    Object.setPrototypeOf(this, SocialReportNotFoundError.prototype);
  }
}

export class SocialReportHandledError extends SocialError {
  constructor() {
    super(SOCIAL_GROUP_V2_ERROR_CODES.reportHandled, 'Báo cáo này đã được xử lý.', 409);
    Object.setPrototypeOf(this, SocialReportHandledError.prototype);
  }
}
