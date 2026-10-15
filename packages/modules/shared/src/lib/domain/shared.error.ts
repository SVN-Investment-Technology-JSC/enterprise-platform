/**
 * Lỗi nghiệp vụ của Hệ dùng chung.
 *
 * Controller bắt đúng lớp này và đổi thành `HttpException` kèm `{ statusCode,
 * code, message }`; lỗi khác là bug và để Nest trả 500. `message` tiếng Việt,
 * hiển thị thẳng cho người dùng.
 */
export class SharedError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SharedError.prototype);
  }
}

export class SharedValidationError extends SharedError {
  constructor(message: string) {
    super('VALIDATION', message, 400);
    Object.setPrototypeOf(this, SharedValidationError.prototype);
  }
}

export class SharedForbiddenError extends SharedError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super('FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, SharedForbiddenError.prototype);
  }
}

export class SharedFolderNotFoundError extends SharedError {
  constructor(reference: string) {
    super('FOLDER_NOT_FOUND', `Thư mục ${reference} không tồn tại hoặc đã bị xoá.`, 404);
    Object.setPrototypeOf(this, SharedFolderNotFoundError.prototype);
  }
}

/**
 * Không thấy tài liệu — hoặc có mà người gọi không được xem (tài liệu mật).
 * Trả cùng một lỗi cho hai trường hợp để không lộ tài liệu mật có tồn tại.
 */
export class SharedDocumentNotFoundError extends SharedError {
  constructor(reference: string) {
    super('DOCUMENT_NOT_FOUND', `Tài liệu ${reference} không tồn tại.`, 404);
    Object.setPrototypeOf(this, SharedDocumentNotFoundError.prototype);
  }
}

export class SharedDocumentLockedError extends SharedError {
  constructor() {
    super('DOCUMENT_LOCKED', 'Tài liệu đang được người khác khoá để chỉnh sửa.', 409);
    Object.setPrototypeOf(this, SharedDocumentLockedError.prototype);
  }
}

export class SharedNameTakenError extends SharedError {
  constructor(name: string) {
    super('NAME_TAKEN', `Đã có mục tên "${name}" ở cùng chỗ.`, 409);
    Object.setPrototypeOf(this, SharedNameTakenError.prototype);
  }
}

/**
 * Tải thêm tệp này sẽ vượt hạn mức dung lượng của tenant.
 *
 * 409 chứ không 507: gateway chặn nhóm 5xx để hiện trang bảo trì, còn đây là
 * tình huống nghiệp vụ người dùng phải đọc được.
 */
export class StorageQuotaExceededError extends SharedError {
  constructor(message: string) {
    super('STORAGE_QUOTA_EXCEEDED', message, 409);
    Object.setPrototypeOf(this, StorageQuotaExceededError.prototype);
  }
}

/** Tenant đã bật phân hệ nhưng migration chưa chạy xong. */
export class SharedNotProvisionedError extends SharedError {
  constructor() {
    super(
      'MODULE_NOT_PROVISIONED',
      'Dữ liệu Hệ dùng chung của tenant đang được khởi tạo. Thử lại sau ít phút.',
      503,
    );
    Object.setPrototypeOf(this, SharedNotProvisionedError.prototype);
  }
}
