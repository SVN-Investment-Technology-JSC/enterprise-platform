/**
 * Lỗi nghiệp vụ của Văn thư. Controller đổi lớp này thành `{ statusCode, code, message }`;
 * lỗi khác là bug và để Nest trả 500. `message` là câu tiếng Việt hiện thẳng cho người dùng.
 */
export class CorrespondenceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CorrespondenceError.prototype);
  }
}

export class CorrespondenceValidationError extends CorrespondenceError {
  constructor(message: string) {
    super('VALIDATION', message, 400);
    Object.setPrototypeOf(this, CorrespondenceValidationError.prototype);
  }
}

export class CorrespondenceForbiddenError extends CorrespondenceError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super('FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, CorrespondenceForbiddenError.prototype);
  }
}

/** Không có, hoặc có mà người gọi không được xem: trả cùng một lỗi. */
export class LetterNotFoundError extends CorrespondenceError {
  constructor() {
    super('LETTER_NOT_FOUND', 'Công văn không tồn tại hoặc bạn không được xem.', 404);
    Object.setPrototypeOf(this, LetterNotFoundError.prototype);
  }
}

export class AttachmentNotFoundError extends CorrespondenceError {
  constructor() {
    super('ATTACHMENT_NOT_FOUND', 'Tệp không tồn tại hoặc đã bị gỡ khỏi hồ sơ.', 404);
    Object.setPrototypeOf(this, AttachmentNotFoundError.prototype);
  }
}

/** Công văn đã sang bước khác (người khác vừa thao tác): tải lại rồi làm tiếp. */
export class LetterStageConflictError extends CorrespondenceError {
  constructor(message = 'Công văn đã chuyển sang bước khác. Hãy tải lại để xem trạng thái mới.') {
    super('STAGE_CONFLICT', message, 409);
    Object.setPrototypeOf(this, LetterStageConflictError.prototype);
  }
}

export class CorrespondenceNotProvisionedError extends CorrespondenceError {
  constructor() {
    super('NOT_PROVISIONED', 'Dữ liệu Văn thư của tenant đang được khởi tạo, thử lại sau ít phút.', 503);
    Object.setPrototypeOf(this, CorrespondenceNotProvisionedError.prototype);
  }
}

/** Hệ dùng chung (nơi giữ tệp) không trả lời được. */
export class FileStoreUnavailableError extends CorrespondenceError {
  constructor(message = 'Không kết nối được kho tài liệu của Hệ dùng chung, thử lại sau.') {
    super('FILE_STORE_UNAVAILABLE', message, 503);
    Object.setPrototypeOf(this, FileStoreUnavailableError.prototype);
  }
}
